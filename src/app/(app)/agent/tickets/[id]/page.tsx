import Link from "next/link";
import { notFound } from "next/navigation";

import { AttachmentStrip } from "@/components/attachment-strip";
import { ConversationDrawer } from "@/components/conversation-drawer";
import {
  Avatar,
  LevelPill,
  PageHead,
  Rating,
  SlaMeter,
  StatusPill,
  UrgencyPill,
} from "@/components/ui";
import { signAttachments } from "@/lib/attachments";
import { isStaff, requireStaff } from "@/lib/auth/session";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/domain/tickets";
import { createClient } from "@/lib/supabase/server";
import { AgentTicketControls } from "./agent-controls";

export const metadata = { title: "Tangani Tiket" };

export default async function AgentTicketDetail({
  params,
}: PageProps<"/agent/tickets/[id]">) {
  const session = await requireStaff();
  const { id } = await params;
  const supabase = await createClient();

  const { data: ticket } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", id)
    .single();

  if (!ticket) notFound();

  const [
    { data: rawMessages },
    { data: customer },
    { data: agent },
    { data: events },
  ] = await Promise.all([
    supabase
      .from("messages")
      .select("*")
      .eq("ticket_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("profiles").select("*").eq("id", ticket.customer_id).single(),
    ticket.assignee_id
      ? supabase.from("profiles").select("*").eq("id", ticket.assignee_id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from("ticket_events")
      .select("*")
      .eq("ticket_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const messages = (rawMessages ?? []).map((m) => ({
    ...m,
    author_name:
      m.author_id === ticket.customer_id
        ? customer?.full_name ?? "Pelanggan"
        : m.author_id === ticket.assignee_id
          ? agent?.full_name ?? "Agen"
          : m.author_id === session.userId
            ? session.profile.full_name
            : "Agen",
  }));

  // Staff see internal notes in the thread.
  const canPost = ticket.status !== "Closed" || isStaff(session.profile.role);

  const ticketAttachments = await signAttachments(ticket.attachments);

  return (
    <>
      <PageHead
        title={ticket.subject}
        sub={`Kode tiket ${ticket.ticket_code}`}
        crumbs={[
          { label: "Board Tiket", href: "/agent/board" },
          { label: ticket.ticket_code },
        ]}
      >
        <Link className="btn btn--ghost" href="/agent/board">
          Kembali ke board
        </Link>
        <ConversationDrawer
          ticketId={ticket.id}
          messages={messages}
          viewer={{ id: session.userId, role: session.profile.role }}
          canPost={canPost}
          closedNotice="Tiket ditutup. Buka kembali lewat panel tindakan untuk membalas."
        />
      </PageHead>

      <div className="split">
        <div className="stack">
          <section className="card">
            <div className="card__head">
              <h2 className="card__title">Keluhan pelanggan</h2>
              <div className="row row--center">
                <StatusPill status={ticket.status} />
                <UrgencyPill urgency={ticket.urgency} />
              </div>
            </div>
            <p className="copy mt-2" style={{ whiteSpace: "pre-wrap" }}>
              {ticket.description}
            </p>

            <AttachmentStrip items={ticketAttachments} />

            {ticket.transaction_history.length > 0 && (
              <>
                <hr className="hair" />
                <h3 className="card__title" style={{ fontSize: 14 }}>
                  Riwayat transaksi
                </h3>
                <div className="tbl__wrap mt-1">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Referensi</th>
                        <th>Tanggal</th>
                        <th>Nilai</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ticket.transaction_history.map((tx, i) => (
                        <tr key={`${tx.ref ?? i}`}>
                          <td className="code-ref">{tx.ref ?? "—"}</td>
                          <td>{formatDate(tx.date ?? null)}</td>
                          <td>{formatCurrency(tx.amount ?? null)}</td>
                          <td>{tx.status ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <AgentTicketControls
            ticket={ticket}
            isAssignee={ticket.assignee_id === session.userId}
          />

          <section className="card">
            <div className="card__head">
              <h2 className="card__title">Percakapan</h2>
              <span className="chip">{messages.length} pesan</span>
            </div>
            <p className="copy mt-2">
              Diskusi tiket ini dibuka di panel samping. Buka lewat tombol
              <strong> Percakapan </strong>
              di atas untuk membaca dan membalas pelanggan.
            </p>
          </section>
        </div>

        <aside className="side">
          <section className="card">
            <h2 className="card__title">Ringkasan tiket</h2>

            <SlaMeter
              createdAt={ticket.created_at}
              deadline={ticket.sla_deadline}
              status={ticket.status}
              breached={ticket.sla_breached}
            />

            <hr className="hair" />

            <dl className="dl">
              <div>
                <dt>Kategori</dt>
                <dd>{ticket.category}</dd>
              </div>
              <div>
                <dt>Level</dt>
                <dd>
                  <LevelPill level={ticket.escalation_level} />
                </dd>
              </div>
              <div>
                <dt>Target SLA</dt>
                <dd>
                  {ticket.sla_policy_minutes
                    ? `${Math.round(ticket.sla_policy_minutes / 60)} jam`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Dibuat</dt>
                <dd>{formatDateTime(ticket.created_at)}</dd>
              </div>
              <div>
                <dt>Batas SLA</dt>
                <dd>{formatDateTime(ticket.sla_deadline)}</dd>
              </div>
              {ticket.first_response_at && (
                <div>
                  <dt>Respons pertama</dt>
                  <dd>{formatDateTime(ticket.first_response_at)}</dd>
                </div>
              )}
              {ticket.closed_at && (
                <div>
                  <dt>Ditutup</dt>
                  <dd>{formatDateTime(ticket.closed_at)}</dd>
                </div>
              )}
              <div>
                <dt>Reopen</dt>
                <dd>{ticket.reopen_count}×</dd>
              </div>
              {ticket.csat_score !== null && (
                <div>
                  <dt>CSAT</dt>
                  <dd>
                    <Rating score={ticket.csat_score} />
                  </dd>
                </div>
              )}
            </dl>

            {ticket.csat_comment && (
              <>
                <hr className="hair" />
                <p className="copy">“{ticket.csat_comment}”</p>
              </>
            )}

            {ticket.tags.length > 0 && (
              <>
                <hr className="hair" />
                <div className="tag-row">
                  {ticket.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="card">
            <h2 className="card__title">Pelanggan</h2>
            {customer && (
              <div className="row row--center mt-2">
                <Avatar name={customer.full_name} tint={customer.avatar_tint} size="lg" />
                <div>
                  <p className="pitem__name">{customer.full_name}</p>
                  <p className="pitem__due">{customer.email}</p>
                  {customer.phone && <p className="pitem__due">{customer.phone}</p>}
                </div>
              </div>
            )}
            {customer?.company && <p className="copy mt-2">{customer.company}</p>}
          </section>

          <section className="card">
            <h2 className="card__title">Agen</h2>
            {agent ? (
              <div className="row row--center mt-2">
                <Avatar name={agent.full_name} tint={agent.avatar_tint} size="lg" />
                <div>
                  <p className="pitem__name">{agent.full_name}</p>
                  <p className="pitem__due">{agent.email}</p>
                </div>
              </div>
            ) : (
              <p className="copy mt-2">Belum ada agen yang mengambil tiket ini.</p>
            )}
          </section>

          {(events ?? []).length > 0 && (
            <section className="card">
              <details className="audit">
                <summary className="audit__summary">
                  <span className="card__title">Audit trail</span>
                  <span className="audit__hint">{(events ?? []).length} pembaruan</span>
                </summary>
                <ol className="timeline mt-2">
                  {(events ?? []).map((e) => (
                    <li className="tl-item" key={e.id}>
                      <span className="tl-item__dot" />
                      <div className="tl-item__body">
                        <p className="tl-item__title">{e.event_type}</p>
                        <p className="tl-item__time">{formatDateTime(e.created_at)}</p>
                        {e.note && <p className="tl-item__note">{e.note}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
