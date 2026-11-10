"use server";

import { isStaff, requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * One row in the top-right bell.
 *
 * Ticket activity is derived from `ticket_events` — every meaningful
 * transition already writes an event, so there is a single source of truth.
 * Account changes (create user, role, activation, password reset) cannot carry
 * a ticket id, so they live in `notifications` and are merged into the same
 * feed here.
 */
export type NotificationItem = {
  id: string;
  kind: "ticket" | "account";
  ticketId: string | null;
  ticketCode: string | null;
  subject: string | null;
  message: string;
  href: string;
  createdAt: string;
};

export type NotificationFeed = {
  items: NotificationItem[];
  /** Last time the caller opened the bell, stored on their profile. */
  seenAt: string | null;
};

type EventRow = {
  id: string;
  ticket_id: string;
  actor_id: string | null;
  event_type: string;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  created_at: string;
};

type TicketRow = {
  id: string;
  ticket_code: string;
  subject: string;
};

type AccountRow = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  created_at: string;
};

/** Turn a raw event into the sentence the bell shows. */
function describe(event: EventRow, ticket: TicketRow): string {
  const code = ticket.ticket_code;

  switch (event.event_type) {
    case "created":
      return `Tiket ${code} dibuat.${event.note ? ` ${event.note}.` : ""}`;

    case "status_changed": {
      const change = `Status tiket ${code}: ${event.from_value ?? "—"} → ${event.to_value ?? "—"}.`;
      return event.note ? `${change} ${event.note}.` : change;
    }

    case "assigned":
      return `Tiket ${code} ditugaskan ke ${event.to_value ?? "programmer"}.${
        event.note ? ` ${event.note}.` : ""
      }`;

    case "csat":
      return `Survei kepuasan tiket ${code}: ${event.to_value ?? "—"}/5.${
        event.note ? ` “${event.note}”` : ""
      }`;

    case "triage_corrected":
      return `Klasifikasi tiket ${code} dikoreksi dari ${event.from_value ?? "—"} ke ${event.to_value ?? "—"}.`;

    case "auto_closed":
      return `Tiket ${code} ditutup otomatis karena tidak ada respons pegawai.`;

    case "message":
      return `Pesan baru dari ${
        event.to_value === "agent" ? "programmer" : "pegawai"
      } pada tiket ${code}.`;

    default:
      return `Pembaruan pada tiket ${code}.`;
  }
}

/**
 * The newest items the caller may see. RLS on `tickets` / `ticket_events`
 * does the ticket access check for us; RLS on `notifications` does the same
 * for account events.
 *
 * A message event authored by the viewer is skipped — nobody needs a bell for
 * their own reply. Everything else stays so the timeline remains explainable.
 */
export async function getNotifications(limit = 20): Promise<NotificationFeed> {
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: profile }, { data: events, error }, { data: accounts }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("notifications_seen_at")
        .eq("id", session.userId)
        .single(),
      supabase
        .from("ticket_events")
        .select(
          "id, ticket_id, actor_id, event_type, from_value, to_value, note, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(limit),
      // Missing before migration 0011: the query simply fails and ticket
      // activity still renders.
      supabase
        .from("notifications")
        .select("id, kind, title, body, href, created_at")
        .eq("recipient_id", session.userId)
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

  const seenAt = profile?.notifications_seen_at ?? null;
  const items: NotificationItem[] = [];

  if (!error && events?.length) {
    const ids = Array.from(new Set(events.map((e) => e.ticket_id)));

    const { data: tickets } = await supabase
      .from("tickets")
      .select("id, ticket_code, subject")
      .in("id", ids);

    const ticketById = new Map((tickets ?? []).map((t) => [t.id, t]));
    const staff = isStaff(session.profile.role);

    for (const event of events) {
      if (event.event_type === "message" && event.actor_id === session.userId) {
        continue;
      }

      const ticket = ticketById.get(event.ticket_id);
      if (!ticket) continue;

      items.push({
        id: event.id,
        kind: "ticket",
        ticketId: event.ticket_id,
        ticketCode: ticket.ticket_code,
        subject: ticket.subject,
        message: describe(event, ticket),
        href: staff
          ? `/agent/tickets/${event.ticket_id}`
          : `/dashboard/tickets/${event.ticket_id}`,
        createdAt: event.created_at,
      });
    }
  }

  for (const row of (accounts ?? []) as AccountRow[]) {
    items.push({
      id: row.id,
      kind: "account",
      ticketId: null,
      ticketCode: null,
      subject: row.body,
      message: row.title,
      href: row.href || "/settings",
      createdAt: row.created_at,
    });
  }

  items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return { items: items.slice(0, limit), seenAt };
}

/**
 * Persist the bell's read marker on the profile, so reading on a laptop also
 * clears the badge on a phone. The profile RLS policy already allows a user to
 * update their own row. Account rows also get their `read_at` stamped.
 */
export async function markNotificationsSeen(): Promise<{ ok: boolean }> {
  const session = await requireSession();
  const supabase = await createClient();
  const now = new Date().toISOString();

  const [{ error }] = await Promise.all([
    supabase
      .from("profiles")
      .update({ notifications_seen_at: now })
      .eq("id", session.userId),
    supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("recipient_id", session.userId)
      .is("read_at", null),
  ]);

  return { ok: !error };
}