# Qrion — Customer Complaint Ticketing CRM

A complaint-handling workspace that runs entirely inside the app dashboard: users file
complaints, the admin back office triages and escalates them, and every closed case is
archived into a searchable knowledge base. Built with **Next.js 16 (App Router)**,
**React 19**, **Tailwind CSS 4**, and **Supabase** (Postgres + Auth + RLS).

The UI follows the *Fernly* reference template (bento cards, green palette, pill controls,
left sidebar rail).

---

## 1. Architecture

```
Browser
  │
  ├─ proxy.ts ─────────── refreshes the Supabase session cookie, bounces anonymous users
  │                       to /login. (Next.js 16 renamed `middleware` to `proxy`.)
  │
  ├─ Server Components ── read data straight from Supabase.
  │                       `src/lib/auth/session.ts` guards every route by role.
  │
  └─ Client Components ── forms + interactivity. They never touch the DB directly:
                          they call Server Actions.
                              │
Server Actions ─────────────────┴─ `src/app/actions/*`
  │  validate input with zod
  │  re-check the caller's role
  │  write to Supabase (as the user, so RLS applies)
  └─ revalidatePath(...) so the affected pages re-render
                              │
Supabase Postgres ────────────┴─ RLS policies, triggers and the SLA engine do the
                                  enforcement that must not be bypassable.
```

Two layers of authorization, deliberately:

| Layer | Where | Purpose |
|---|---|---|
| Session / role guard | `src/lib/auth/session.ts` (`requireCustomer`, `requireStaff`, `requireAdmin`) | decides which *pages* a role may open |
| Row Level Security | `supabase/migrations/0001_init.sql` | decides which *rows* a user may read or write, even if a server action is called directly |

Server Actions are reachable by direct POST, so every action re-verifies the caller itself —
the UI guard alone is never trusted.

---

## 2. Database schema

The full migration is `supabase/migrations/0001_init.sql`. Run it once in the
Supabase SQL Editor.

### Enums

`user_role` · `urgency_level` · `ticket_status` · `escalation_level` ·
`message_author_role` · `message_kind`

### Tables

**`tickets`** — the complaint itself.

| Column | Notes |
|---|---|
| `id` | uuid, primary key |
| `ticket_code` | **automatic**, e.g. `TKT-2611-100042` (sequence + format) |
| `customer_id` | → `profiles.id` |
| `assignee_id` | → `profiles.id`, the agent handling it |
| `subject`, `description` | validated lengths |
| `category` | Transaksi, Pembayaran, Pengiriman, Akun, Teknis, Produk, Lainnya |
| `urgency` | Low, Medium, High, Critical |
| `status` | Open, In Progress, Waiting Validation, Closed |
| `escalation_level` | L1, L2, L3 |
| `sla_deadline` | **computed by trigger** from `sla_policy` |
| `sla_policy_minutes` | the target in force |
| `transaction_ref/date/amount`, `transaction_history` | jsonb snapshot of what the complaint refers to |
| `first_response_at`, `resolved_at`, `closed_at` | lifecycle stamps |
| `sla_breached`, `reopen_count` | quality signals |
| `csat_score`, `csat_comment`, `csat_at` | post-closure survey |
| `resolution_summary`, `tags` | knowledge-base archive |

**`messages`** — the chat thread. `author_role` (customer/agent/system) and
`kind` (`text` | `note` | `system` | `solution`). Internal `note`s are filtered out of the
customer's view. `solution` messages additionally flip the ticket to *Waiting Validation*.

**`profiles`** — one row per `auth.users` row, created automatically by the
`on_auth_user_created` trigger on signup. Holds `role`, so role checks are a single table read.

**`ticket_events`** — immutable audit trail: `created`, `status_changed`, `escalated`,
`assigned`, `csat`, `knowledge_published`.

**`sla_policy`** — the SLA matrix as *data*, keyed by `(urgency, level)`. Changing a target
is an `UPDATE`, not a deploy.

**`ticket_knowledge`** (view) — joins tickets to customer/agent names and computes
`hours_to_close`. Powers the Knowledge Base page. RLS still applies because the view runs
with the caller's permissions.

### The SLA engine

`sla_policy` holds the targets; `tickets_before_write()` applies them.

On insert, and on any change to `urgency` or `escalation_level`, the trigger recomputes
`sla_deadline = created_at + resolve_minutes`. Responses therefore stay honest: escalating a
ticket shortens its window, measured from when the customer actually complained — not from
when the agent escalated.

| Level | Critical | High | Medium | Low |
|---|---|---|---|---|
| **L1** Frontline | 4 h | 8 h | 24 h | 72 h |
| **L2** Technical | 2 h | 4 h | 12 h | 48 h |
| **L3** Management | 1 h | 3 h | 8 h | 24 h |

The same trigger stamps `closed_at` / `resolved_at` as the status moves, and
`refresh_sla_breaches()` (callable from a scheduled job) flags overdue tickets.

### Row Level Security

- **tickets** — users see only their own; admins see all. Users insert as themselves.
- **messages** — anyone attached to the ticket can read. Users may post only as
  `customer`; admins only as `agent`/`system`.
- **profiles** — you see yourself and admins, plus the counterparty on a shared ticket. A
  non-admin cannot promote their own role (enforced in the policy's `WITH CHECK`).
- **sla_policy** — readable by signed-in users, writable by admins only.

`is_staff()` and `is_admin()` are `SECURITY DEFINER`, which is what prevents the infinite
recursion you otherwise hit when a policy on `profiles` needs to read `profiles`. Both
helpers are owned by `postgres` (which bypasses RLS) with a pinned `search_path`;
migration `0002` repairs this if you ran `0001` before the fix landed.

### Roles

There are exactly **two** roles: `user` and `admin`. A `user` is the customer — they
self-register and live in `/dashboard`. An `admin` is the back office and owns every
staff screen (`/agent`, `/agent/board`, `/knowledge`, `/admin/users`). Migration `0003`
collapses the earlier four-role enum (`customer`/`agent`/`manager`/`admin`) down to these
two. The `message_author_role` enum is untouched — it records who wrote a chat message,
which is a different axis and still useful in the thread.

---

## 3. Backend flow (Server Actions)

`src/app/actions/`

### `tickets.ts` — Triage & SLA
`createTicket()` runs when a customer submits a complaint:
1. validates with zod,
2. snapshots recent transaction history,
3. derives the priority via `triageUrgency()` (keyword scoring + category weight +
   transaction value) unless the customer overrode it,
4. inserts — Postgres mints `ticket_code` and the trigger pins `sla_deadline`,
5. seeds the thread with a system acknowledgement and writes the audit event.

### `workflow.ts` — the ticket lifecycle

| Action | Transition |
|---|---|
| `claimTicket` | Open → In Progress, assigns the agent, stamps first response |
| `escalateTicket` / `escalateToNextLevel` | L1 → L2 → L3, recomputes SLA, posts a system message with the reason |
| `proposeSolution` | posts a `solution` message → **Waiting Validation** |
| `validateResolution` | satisfied → **Closed**; not satisfied → **In Progress** + `reopen_count += 1` + a customer message explaining what is still wrong |
| `submitCsat` | stores the 1–5 score and comment (only on a closed ticket, only by its owner) |
| `sendMessage` | appends to the thread; internal notes stay staff-only |
| `publishToKnowledgeBase` | archives the resolution summary + tags |
| `updateTicketStatus` | generic, validated against the transition table |

Status transitions are declared once in `src/lib/domain/tickets.ts` and enforced server-side:

```
Open               → In Progress | Closed
In Progress        → Waiting Validation | Closed
Waiting Validation → Closed | In Progress
Closed             → In Progress          (reopen)
```

### `auth.ts` / `admin.ts`
`signIn`, `signUp`, `signOut`, `updateProfile`.
`createUser`, `updateUserRole`, `resetUserPassword`, `refreshSlaBreaches` — all admin-only,
all behind `requireAdmin()`. `createUser` uses the `service_role` client because creating an
auth user on someone else's behalf is beyond the anon key.

---

## 4. Frontend routes

### Customer (`/dashboard`)
| Route | What it does |
|---|---|
| `/dashboard` | overview: counts, SLA targets, tickets awaiting your confirmation |
| `/dashboard/new` | complaint form with a **live triage + SLA preview** |
| `/dashboard/tickets` | full list, filterable by status |
| `/dashboard/tickets/[id]` | chat thread, **"Masalah Selesai / Belum Selesai"** validation panel, CSAT modal after closure |

### Back office (`/agent`)
| Route | What it does |
|---|---|
| `/agent` | queue sorted by breach-then-deadline, SLA gauge, CSAT |
| `/agent/board` | **Kanban** by status, sortable by priority or SLA, draggable cards |
| `/agent/tickets/[id]` | full complaint, transaction history, thread, and the handling panel: send solution · escalate L1→L3 · change status · archive |
| `/agent/analytics` | 30-day throughput, priority mix, per-category and per-handler performance |

### Shared
| Route | What it does |
|---|---|
| `/knowledge` | searchable archive of past resolutions with CSAT and duration analytics |
| `/admin/users` | create accounts, change roles, deactivate, reset passwords |
| `/settings`, `/help`, `/search` | profile, policy reference, global ticket search |

---

## 5. Setup

### 1. Install

```bash
npm install
```

### 2. Configure

`.env.local` is already populated with the project URL and publishable key. Add the
service-role secret to enable in-app account creation:

```
SUPABASE_SERVICE_ROLE_KEY=...      # Dashboard > Project Settings > API > service_role
```

Without it the app still runs; only **Kelola Pengguna → Buat akun baru** stays disabled.
Never expose this key to the browser or prefix it with `NEXT_PUBLIC_`.

### 3. Create the schema

Open the Supabase SQL Editor and run the migrations **in order**:

1. `supabase/migrations/0001_init.sql` — enums, tables, indexes, triggers, RLS
   policies and the `ticket_knowledge` view, and seeds the `sla_policy` matrix.
2. `supabase/migrations/0002_fix_profiles_recursion.sql` — repairs the
   `profiles` RLS recursion and hardens the `SECURITY DEFINER` helpers.
   *Skip only if `0001` was run after this fix was committed.*
3. `supabase/migrations/0003_simplify_roles.sql` — collapses the role enum to
   `user` + `admin` and rebuilds the affected policies.

All three are idempotent, so re-running is harmless.

### 4. Make yourself an admin

Sign up through `/register`, then promote your account once:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

From then on, create every other account from **/admin/users**.

### 5. Allow sign-in

Supabase disables the Email provider by default, and even once enabled it
requires the user to click a confirmation link before they can log in. For a
demo both are dead ends, so fix them together:

> Dashboard → Authentication → Sign In / Providers → **Email**:
> - **Enable Email provider** → **ON**
> - **Confirm email** → **OFF**
> - Save.

After that `signUp` returns a live session and the new user lands on
`/dashboard` straight away. Leave confirmation on if you prefer verified
addresses — the register form already shows the "check your email" notice in
that case.

### 6. (Optional) Load demo data

To populate the dashboards with 24 sample tickets and their conversations, run
`supabase/seed_demo.sql` in the SQL Editor — but only after step 4, since it
attaches the tickets to existing profiles.

### 7. Run

```bash
npm run dev        # http://localhost:3000
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

---

## 6. Project layout

```
src/
├─ proxy.ts                      session refresh + auth redirect (Next 16 `proxy`)
├─ app/
│  ├─ actions/                   server actions (tickets, workflow, auth, admin)
│  ├─ agent/                     agent dashboard, kanban, analytics, ticket detail
│  ├─ admin/users/               account provisioning
│  ├─ dashboard/                 customer area
│  ├─ knowledge/ help/ settings/ search/
│  ├─ login/ register/
│  └─ globals.css                Fernly design tokens (Tailwind 4 @theme) + components
├─ components/                   app shell, chat thread, CSAT modal, validation panel, icons
└─ lib/
   ├─ auth/session.ts            requireSession / requireCustomer / requireStaff / requireAdmin
   ├─ domain/tickets.ts          SLA matrix, status machine, triage heuristic, formatters
   ├─ supabase/                  browser / server / admin clients
   └─ types/database.ts          schema types

supabase/migrations/0001_init.sql
supabase/migrations/0002_fix_profiles_recursion.sql
supabase/migrations/0003_simplify_roles.sql
```

---

## 7. Notes

- **Roles.** Two of them: `user` and `admin`. A `user` self-registers on `/register`; an
  `admin` is created by another admin (or promoted via SQL). `proxy.ts` only checks "is
  anyone signed in?" — role routing happens in the page guards, because that needs a
  database read.
- **Cache Components** is intentionally off in `next.config.ts`. Every route is per-user and
  behind auth, so a static shell would add `<Suspense>` boundaries around each cookie and
  query without benefit.
- **SLA breaches** are recomputed on read (`slaState()` in the UI) and can be stamped into
  the database by calling the `refresh_sla_breaches()` RPC on a schedule — `pg_cron` or a
  Supabase Edge Function cron.
