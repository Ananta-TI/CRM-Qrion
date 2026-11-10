# Qrion — Customer Complaint Ticketing CRM

A complaint-handling workspace for fellow employees: an employee files a complaint to a
specific programmer (or to the shared "All" queue), the programmer handles it in a private
workspace, and the employee validates the solution. Built with **Next.js 16 (App Router)**,
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
| Row Level Security | `supabase/migrations/0001_init.sql` + `0010_programmer_assignment.sql` + `0011_usernames_notifications_categories.sql` | decides which *rows* a user may read or write, even if a server action is called directly |

Server Actions are reachable by direct POST, so every action re-verifies the caller itself —
the UI guard alone is never trusted.

---

## 2. Database schema

The schema is built by `supabase/migrations/0001_init.sql` and refined by later
migrations. On a fresh database, run them in order (or paste `APPLY-ALL.sql`
after `0001-0003`); the current security model depends on `0010`, and username
login / self-service credentials / account notifications depend on `0011`.

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
| `assignee_id` | → `profiles.id`; specific programmer, or `NULL` for the shared "All" queue |
| `subject`, `description` | validated lengths |
| `category` | Server, Teknis, Keuangan, Akun, Transaksi, Pembayaran, Pengiriman, Produk, Lainnya |
| `urgency` | Low, Medium, High, Critical |
| `status` | Open, In Progress, Waiting Validation, Closed |
| `escalation_level` | legacy SLA key, always `L1` for new tickets |
| `sla_deadline` | **computed by trigger** from `sla_policy` |
| `sla_policy_minutes` | the target in force |
| `transaction_ref/date/amount`, `transaction_history` | jsonb snapshot of what the complaint refers to |
| `first_response_at`, `resolved_at`, `closed_at` | lifecycle stamps |
| `sla_breached`, `reopen_count` | quality signals |
| `csat_score`, `csat_comment`, `csat_at` | post-closure survey |
| `resolution_summary`, `tags` | resolution note and search tags |

**`messages`** — the chat thread. `author_role` (customer/agent/system) and
`kind` (`text` | `note` | `system` | `solution`). The `agent` value is the historical
enum name for the programmer side. Internal `note`s are filtered out of the employee's
view. `solution` messages additionally flip the ticket to *Waiting Validation*.

**`profiles`** — one row per `auth.users` row, created automatically by the
`on_auth_user_created` trigger on signup. Holds `role`, so role checks are a single table read.
`username` is an optional lowercase login handle with a case-insensitive unique index; the
owner may edit their own username, email and password from Pengaturan.

**`ticket_events`** — immutable audit trail: `created`, `status_changed`, `assigned`, `csat`,
plus legacy `escalated` / `knowledge_published` rows from before the simplification.

**`notifications`** — account-level notices for programmers (new user, role change,
activation change, password reset). Ticket activity still comes from `ticket_events`; the bell
merges both feeds. Rows are readable only by their recipient and can only be inserted by the
`notify_programmers()` RPC.

**`sla_policy`** — the SLA matrix as *data*, keyed by `(urgency, level)`. Changing a target
is an `UPDATE`, not a deploy. Only the L1 row is used for new tickets now; the level column
is retained because the trigger still reads it.

### The SLA engine

`sla_policy` holds the targets; `tickets_before_write()` applies them.

On insert, and on any change to `urgency` or `escalation_level`, the trigger recomputes
`sla_deadline = created_at + resolve_minutes`. New tickets always start at L1; the other
levels remain in the policy table for historical rows but are no longer reachable from the
UI.

| Level | Critical | High | Medium | Low |
|---|---|---|---|---|
| **L1** Frontline | 4 h | 8 h | 24 h | 72 h |
| **L2** Technical (legacy) | 2 h | 4 h | 12 h | 48 h |
| **L3** Management (legacy) | 1 h | 3 h | 8 h | 24 h |

The same trigger stamps `closed_at` / `resolved_at` as the status moves, and
`refresh_sla_breaches()` (callable from a scheduled job) flags overdue tickets.

### Row Level Security

- **tickets** — employees see only their own; a programmer sees tickets assigned to them plus
  the unassigned "All" queue. Assignment to an arbitrary non-programmer profile is rejected.
- **messages** — anyone attached to the ticket can read. Employees may post only as
  `customer`; programmers only as `agent`/`system`. A programmer who is not the assignee
  cannot read an assigned ticket's thread.
- **profiles** — you see yourself and admins, plus the counterparty on a shared ticket. A
  non-admin cannot promote their own role (enforced in the policy's `WITH CHECK`); migration
  `0011` also blocks self-service role, active-flag and unverified-email changes in a trigger.
- **notifications** — each programmer reads only rows addressed to them; inserts happen
  through the programmer-only `notify_programmers()` RPC.
- **sla_policy** — readable by signed-in users, writable by admins only.

`is_staff()` and `is_admin()` are `SECURITY DEFINER`, which is what prevents the infinite
recursion you otherwise hit when a policy on `profiles` needs to read `profiles`. Both
helpers are owned by `postgres` (which bypasses RLS) with a pinned `search_path`;
migration `0002` repairs this if you ran `0001` before the fix landed. Migration `0010`
adds the assignment-aware `can_access_ticket()` and `is_programmer()` helpers.

### Roles

There are exactly **two** roles: `user` and `admin`. A `user` is an employee — they
self-register and live in `/dashboard`. An `admin` is a programmer and owns the handling
screens (`/agent`, `/agent/board`, `/agent/analytics`, `/admin/users`). The UI labels them
**Pegawai** and **Programmer**. Migration `0003` collapses the earlier four-role enum
(`customer`/`agent`/`manager`/`admin`) down to these two. The `message_author_role` enum is
untouched — it records who wrote a chat message, which is a different axis and still useful
in the thread.

---

## 3. Backend flow (Server Actions)

`src/app/actions/`

### `tickets.ts` — Triage & SLA
`createTicket()` runs when an employee submits a complaint:
1. validates with zod, including the optional programmer target,
2. snapshots recent transaction history,
3. derives the priority via `triageUrgency()` (keyword scoring + category weight +
   transaction value),
4. inserts — Postgres mints `ticket_code`, the trigger pins `sla_deadline`, and
   `assignee_id` is either the chosen programmer or `NULL` for the shared queue,
5. writes the audit event. The thread starts empty; the employee can chat immediately.

### `workflow.ts` — the ticket lifecycle

| Action | Transition |
|---|---|
| `claimTicket` | Open → In Progress, assigns the programmer, stamps first response |
| `proposeSolution` | posts a `solution` message → **Waiting Validation** |
| `validateResolution` | satisfied → **Closed**; not satisfied → **In Progress** + `reopen_count += 1` + a customer message explaining what is still wrong |
| `submitCsat` | stores the 1–5 score and comment (only on a closed ticket, only by its owner) |
| `sendMessage` | appends to the thread immediately; internal notes stay programmer-only |
| `updateTicketStatus` | generic, validated against the transition table |

Status transitions are declared once in `src/lib/domain/tickets.ts` and enforced server-side:

```
Open               → In Progress | Closed
In Progress        → Waiting Validation | Closed
Waiting Validation → Closed | In Progress
Closed             → In Progress          (reopen)
```

### `auth.ts` / `admin.ts`
`signIn` accepts **email or username**; a username is resolved through
`email_for_username()` before Supabase verifies the password. `signUp`, `signOut`,
`updateProfile`, plus the self-service `updateUsername`, `updateEmail` and `updatePassword`
actions. Email and password changes require the current password; email changes apply
immediately through the Auth Admin API when `SUPABASE_SERVICE_ROLE_KEY` is configured.

`createUser`, `updateUserRole`, `resetUserPassword`, `refreshSlaBreaches` — all admin-only,
all behind `requireAdmin()`. `createUser` uses the `service_role` client because creating an
auth user on someone else's behalf is beyond the anon key. Every create / role / activation
/ reset action calls `notify_programmers()` and the UI confirms role/status changes in a
dialog first.

---

## 4. Frontend routes

### Employee (`/dashboard`)
| Route | What it does |
|---|---|
| `/dashboard` | overview: counts, SLA targets, tickets awaiting your confirmation |
| `/dashboard/new` | complaint form with a category picker (or auto-detect), a programmer target picker, and a **live triage + SLA preview** |
| `/dashboard/tickets` | full list, filterable by status |
| `/dashboard/tickets/[id]` | chat thread, **"Masalah Selesai / Belum Selesai"** validation panel, CSAT modal after closure |

### Programmer (`/agent`)
| Route | What it does |
|---|---|
| `/agent` | assigned plus shared-queue tickets, sorted by breach-then-deadline |
| `/agent/board` | searchable, paginated queue; claim a shared ticket or open an assigned one |
| `/agent/tickets/[id]` | full complaint, transaction history, thread, and the handling panel: send solution · change status · correct triage |
| `/agent/analytics` | 30-day throughput, priority mix, and SLA/CSAT aggregates for visible tickets |

### Shared
| Route | What it does |
|---|---|
| `/admin/users` | create accounts, change roles, deactivate, reset passwords |
| `/settings`, `/search` | profile and global ticket search |

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

`CRON_SECRET` is only needed if you rely on the serverless auto-close fallback rather
than `pg_cron`:

```
CRON_SECRET=...                    # any long random string; Vercel Cron sends it
```

### 3. Create the schema

Open the Supabase SQL Editor and run the migrations **in order**:

1. `supabase/migrations/0001_init.sql` — enums, tables, indexes, triggers, RLS
   policies and the `ticket_knowledge` view (removed by `0010`), and seeds the
   `sla_policy` matrix.
2. `supabase/migrations/0002_fix_profiles_recursion.sql` — repairs the
   `profiles` RLS recursion and hardens the `SECURITY DEFINER` helpers.
   *Skip only if `0001` was run after this fix was committed.*
3. `supabase/migrations/0003_simplify_roles.sql` — collapses the role enum to
   `user` + `admin` and rebuilds the affected policies.
4. `supabase/migrations/0004_ticket_attachments.sql` — `tickets.attachments` plus the
   private `ticket-attachments` storage bucket and its policies.
5. `supabase/migrations/0005_get_my_profile.sql` — one-round-trip session read and the
   nav badge counts.
6. `supabase/migrations/0006_repair_tickets_policies.sql` — restores the `tickets`
   INSERT policy (fixes "new row violates row-level security policy").
7. `supabase/migrations/0007_notifications.sql` — event-feed index and the
   system-message read policy the bell depends on.
8. `supabase/migrations/0008_operational_hardening.sql` — `profiles.notifications_seen_at`,
   SLA pause/resume bookkeeping, the pause-aware `tickets_before_write`,
   `refresh_sla_breaches()` and `auto_close_stale_tickets()`.
9. `supabase/migrations/0009_security_fixes.sql` — makes `ticket_knowledge` obey the
   caller's RLS (`security_invoker = true`) and stops `get_nav_counts()` from exposing
   the global staff queue to customers.
10. `supabase/migrations/0010_programmer_assignment.sql` — adds
    `is_programmer()` and `list_programmers()`, makes ticket/message/event access
    assignment-aware, fixes nav counts, and drops `ticket_knowledge`.
11. `supabase/migrations/0011_usernames_notifications_categories.sql` — adds
    `profiles.username` with a case-insensitive unique index, username login lookup,
    self-service credential guard, `notifications` + `notify_programmers()`, and the
    Server / Keuangan categories.

All eleven are idempotent, so re-running is harmless. `supabase/APPLY-ALL.sql` concatenates
migrations **0004-0011** in one file (run `0001-0003` first on a fresh database).
**0011 is required before deploying** username login, self-service credentials, account
notifications and the new categories. **0010** enforces programmer assignment privacy and
drops the `ticket_knowledge` endpoint that leaked other customers' tickets.

Migration `0008` also schedules the auto-close job with `pg_cron` **when the extension is
enabled**; otherwise the block is a no-op. To use the serverless fallback instead, set
`CRON_SECRET` in the environment — `vercel.json` already points Vercel Cron at
`/api/cron/auto-close` every hour at minute 15.

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
│  ├─ agent/                     programmer dashboard, queue, analytics, ticket detail
│  ├─ admin/users/               account provisioning
│  ├─ dashboard/                 employee area
│  ├─ settings/ search/
│  ├─ api/cron/auto-close/       serverless fallback for stale-ticket auto-close
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
supabase/migrations/0004_ticket_attachments.sql
supabase/migrations/0005_get_my_profile.sql
supabase/migrations/0006_repair_tickets_policies.sql
supabase/migrations/0007_notifications.sql
supabase/migrations/0008_operational_hardening.sql
supabase/migrations/0009_security_fixes.sql
supabase/migrations/0010_programmer_assignment.sql
supabase/migrations/0011_usernames_notifications_categories.sql
supabase/APPLY-ALL.sql
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
  Supabase Edge Function cron. It skips tickets whose clock is paused.
- **SLA pauses while the customer has the ball.** Any real agent reply (`kind <> 'note'`)
  and any entry into `Waiting Validation` stop the clock; a customer reply — or leaving
  validation, or closing — restarts it and pushes `sla_deadline` forward by exactly the
  time that was spent waiting. `sla_paused_at` marks a *running* pause, `sla_paused_minutes`
  banks the *completed* ones, and `slaState()` subtracts the banked total from both the
  window and the elapsed time so a resumed ticket is not punished for the wait.
- **Auto-close.** A `Waiting Validation` ticket with no customer response for 3 days is
  closed by `auto_close_stale_tickets(3)` with an `auto_closed` event and a system message.
  `resolved_at` is re-stamped on every entry into `Waiting Validation`, so the clock restarts
  each round. Scheduled by `pg_cron` when available, else by Vercel Cron through
  `/api/cron/auto-close` (guarded by `CRON_SECRET`; that route is exempt from the auth
  redirect in `proxy.ts` because schedulers carry no session cookie).
- **Reopening** is customer-only, `Closed`-only, and limited to 7 days after `closed_at`;
  later than that the UI offers "Buat tiket baru" instead so the old SLA history stays
  honest. A reopen shifts `sla_deadline` forward by the closed gap and banks it like any
  other pause.
- **Claiming is atomic.** `claimTicket()` writes with `... WHERE assignee_id IS NULL` and
  reads back 0 rows if it lost the race, in which case the caller is told the ticket was
  already taken. Assigned tickets are never re-claimable.
- **Notification read state** lives on `profiles.notifications_seen_at`, so opening the bell
  on one device clears the badge everywhere. Ticket items are derived from `ticket_events`;
  account items live in `notifications` and are merged into the same feed.
