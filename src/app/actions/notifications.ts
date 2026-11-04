"use server";

import { isStaff, requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * One row in the top-right bell.
 *
 * Notifications are derived from `ticket_events` instead of a separate table:
 * every meaningful transition already writes an event, so there is a single
 * source of truth and no risk of the two drifting apart.
 */
export type NotificationItem = {
  id: string;
  ticketId: string;
  ticketCode: string;
  subject: string;
  message: string;
  href: string;
  createdAt: string;
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
  sla_policy_minutes: number | null;
};

/** Turn a raw event into the sentence the bell shows. */
function describe(event: EventRow, ticket: TicketRow): string {
  const code = ticket.ticket_code;

  switch (event.event_type) {
    case "escalated": {
      const targetHours = ticket.sla_policy_minutes
        ? Math.round(ticket.sla_policy_minutes / 60)
        : null;

      return [
        `Tiket dieskalasi dari ${event.from_value ?? "L1"} ke ${event.to_value ?? "L2"}.`,
        `Alasan: ${event.note ?? "—"}.`,
        targetHours ? `Target SLA baru: ${targetHours} jam.` : null,
      ]
        .filter(Boolean)
        .join(" ");
    }

    case "created":
      return `Tiket ${code} dibuat.${event.note ? ` ${event.note}.` : ""}`;

    case "status_changed": {
      const change = `Status tiket ${code}: ${event.from_value ?? "—"} → ${event.to_value ?? "—"}.`;
      return event.note ? `${change} ${event.note}.` : change;
    }

    case "assigned":
      return `Tiket ${code} ditugaskan ke ${event.to_value ?? "agen"}.${
        event.note ? ` ${event.note}.` : ""
      }`;

    case "csat":
      return `Survei kepuasan tiket ${code}: ${event.to_value ?? "—"}/5.${
        event.note ? ` “${event.note}”` : ""
      }`;

    case "knowledge_published":
      return `Resolusi tiket ${code} diarsipkan ke Knowledge Base.`;

    case "message":
      return `Pesan baru dari ${
        event.to_value === "agent" ? "agen" : "pelanggan"
      } pada tiket ${code}.`;

    default:
      return `Pembaruan pada tiket ${code}.`;
  }
}

/**
 * The newest events the caller is allowed to see. RLS on `tickets` /
 * `ticket_events` does the access check for us.
 *
 * A message event authored by the viewer is skipped — nobody needs a bell for
 * their own reply. Everything else (including your own escalations) is kept so
 * the timeline stays explainable.
 */
export async function getNotifications(limit = 20): Promise<NotificationItem[]> {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: events, error } = await supabase
    .from("ticket_events")
    .select(
      "id, ticket_id, actor_id, event_type, from_value, to_value, note, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !events?.length) return [];

  const ids = Array.from(new Set(events.map((e) => e.ticket_id)));

  const { data: tickets } = await supabase
    .from("tickets")
    .select("id, ticket_code, subject, sla_policy_minutes")
    .in("id", ids);

  const ticketById = new Map((tickets ?? []).map((t) => [t.id, t]));
  const staff = isStaff(session.profile.role);

  return events.flatMap((event) => {
    if (event.event_type === "message" && event.actor_id === session.userId) {
      return [];
    }

    const ticket = ticketById.get(event.ticket_id);
    if (!ticket) return [];

    return [
      {
        id: event.id,
        ticketId: event.ticket_id,
        ticketCode: ticket.ticket_code,
        subject: ticket.subject,
        message: describe(event, ticket),
        href: staff
          ? `/agent/tickets/${event.ticket_id}`
          : `/dashboard/tickets/${event.ticket_id}`,
        createdAt: event.created_at,
      },
    ];
  });
}
