"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { claimTicket } from "@/app/actions/workflow";
import { IconChat, IconFlag } from "@/components/icons";
import { LevelPill, SlaMeter, StatusPill, UrgencyPill } from "@/components/ui";
import { SLA_POLICY, relativeTime } from "@/lib/domain/tickets";
import type { Ticket } from "@/lib/types/database";

export type BoardTicket = Ticket & {
  customer_name: string;
  message_count: number;
};

/**
 * The agent queue as a plain list: searchable, paginated, and readable on a
 * phone. Replaces the old drag-and-drop Kanban board, which looked good but
 * did not actually move tickets between columns.
 */
export function TicketBoard({ tickets }: { tickets: BoardTicket[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function claim(id: string) {
    setPendingId(id);
    startTransition(async () => {
      await claimTicket(id);
      setPendingId(null);
      router.refresh();
    });
  }

  return (
    <div className="stack mt-3">
      {tickets.length === 0 && (
        <section className="card">
          <p className="empty">Tidak ada tiket yang cocok.</p>
        </section>
      )}

      {tickets.map((ticket) => {
        const targetHours = SLA_POLICY.L1[ticket.urgency].resolve / 60;

        return (
          <section className="card" key={ticket.id}>
            <div className="detail__head">
              <div style={{ flex: 1, minWidth: 240 }}>
                <div className="row row--center">
                  <span className="code-ref">{ticket.ticket_code}</span>
                  <StatusPill status={ticket.status} />
                  <UrgencyPill urgency={ticket.urgency} />
                  <LevelPill level={ticket.escalation_level} />
                </div>

                <Link
                  className="detail__title"
                  href={`/agent/tickets/${ticket.id}`}
                  style={{ display: "block", marginTop: 8 }}
                >
                  {ticket.subject}
                </Link>

                <div className="detail__meta">
                  <span>{ticket.customer_name}</span>
                  <span>Dibuat {relativeTime(ticket.created_at)}</span>
                  <span className="row row--center" style={{ gap: 4 }}>
                    <IconChat style={{ width: 13, height: 13 }} /> {ticket.message_count}
                  </span>
                  {ticket.sla_breached && ticket.status !== "Closed" && (
                    <span className="sla-note--breached row row--center" style={{ gap: 5 }}>
                      <IconFlag style={{ width: 13, height: 13 }} /> Lewat target{" "}
                      {Math.round(targetHours)} jam
                    </span>
                  )}
                </div>
              </div>

              <div style={{ minWidth: 220 }}>
                <SlaMeter
                  createdAt={ticket.created_at}
                  deadline={ticket.sla_deadline}
                  status={ticket.status}
                  breached={ticket.sla_breached}
                  showWindow={false}
                />
              </div>
            </div>

            <div className="row mt-2">
              <Link className="btn btn--ghost btn--sm" href={`/agent/tickets/${ticket.id}`}>
                Tangani tiket
              </Link>
              {!ticket.assignee_id && ticket.status !== "Closed" && (
                <button
                  className="btn btn--primary btn--sm"
                  type="button"
                  disabled={pendingId === ticket.id}
                  onClick={() => claim(ticket.id)}
                >
                  {pendingId === ticket.id ? "Mengambil…" : "Ambil tiket"}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
