"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { claimTicket } from "@/app/actions/workflow";
import { IconChat, IconFlag } from "@/components/icons";
import { SlaMeter, StatusPill, UrgencyPill } from "@/components/ui";
import { SLA_POLICY, relativeTime } from "@/lib/domain/tickets";
import type { Ticket } from "@/lib/types/database";

export type BoardTicket = Ticket & {
  customer_name: string;
  message_count: number;
};

/**
 * The programmer queue as a plain list: searchable, paginated, and readable on
 * a phone. Assigned tickets belong to one programmer; unassigned tickets are
 * the shared "All" queue and can be claimed.
 */
export function TicketBoard({ tickets }: { tickets: BoardTicket[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [, startTransition] = useTransition();

  function claim(id: string) {
    setPendingId(id);
    setClaimError(null);
    startTransition(async () => {
      const result = await claimTicket(id);
      setPendingId(null);
      if (!result.ok) {
        setClaimError({ id, message: result.error });
      }
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
                </div>

                <Link
                  className="detail__title"
                  href={`/agent/tickets/${ticket.id}`}
                  prefetch={false}
                  style={{ display: "block", marginTop: 8 }}
                >
                  {ticket.subject}
                </Link>

                <div className="detail__meta">
                  <span>{ticket.customer_name}</span>
                  <span>{ticket.assignee_id ? "Ditugaskan ke Anda" : "Terbuka untuk semua programmer"}</span>
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
                  paused={Boolean(ticket.sla_paused_at)}
                  pausedAt={ticket.sla_paused_at}
                  pausedMinutes={ticket.sla_paused_minutes}
                  showWindow={false}
                />
              </div>
            </div>

            {claimError?.id === ticket.id && (
              <p className="form-note form-note--err mt-2" role="alert">
                {claimError.message}
              </p>
            )}

            <div className="row mt-2">
              <Link className="btn btn--ghost btn--sm" href={`/agent/tickets/${ticket.id}`} prefetch={false}>
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
