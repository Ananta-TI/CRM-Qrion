import Link from "next/link";
import { notFound } from "next/navigation";

import { AttachmentStrip } from "@/components/attachment-strip";
import { ConversationDrawer } from "@/components/conversation-drawer";
import { CsatModal } from "@/components/csat-modal";
import { ReopenButton } from "@/components/reopen-button";
import { ValidationPanel } from "@/components/validation-panel";
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
import { requireCustomer } from "@/lib/auth/session";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/domain/tickets";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Detail Tiket" };

export default async function CustomerTicketDetail({
  params,
  searchParams,
}: PageProps<"/dashboard/tickets/[id]">) {
  const session = await requireCustomer();
  const { id } = await params;
  const query = await searchParams;

  const supabase = await createClient();

  const { data: ticket } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", id)
    .single();

  // RLS already hides other people's tickets; this is the friendly 404.
  if (!ticket || ticket.customer_id !== session.userId) notFound();

  const [{ data: rawMessages }, { data: agent }, { data: events }] = await Promise.all([
    supabase
      .from("messages")
      .select("*")
      .eq("ticket_id", id)
      .order("created_at", { ascending: true }),
    ticket.assignee_id
      ? supabase.from("profiles").select("*").eq("id", ticket.assignee_id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from("ticket_events")
      .select("*")
      .eq("ticket_id", id)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const visible = (rawMessages ?? []).filter((m) => m.kind !== "note");
  const messages = visible.map((m) => ({
    ...m,
    author_name:
      m.author_role === "customer"
        ? session.profile.full_name
        : m.author_id === ticket.assignee_id
          ? agent?.full_name ?? "Agen"
          : "Agen",
  }));

  // Chat is locked until a real agent reply exists. System notices and
  // internal notes do not count.
  const agentHasReplied = visible.some(
    (m) => m.author_role === "agent" && m.kind !== "note",
  );
  const isClosed = ticket.status === "Closed";
  const canPost = !isClosed && agentHasReplied;
  const closedNotice = isClosed
    ? "Tiket sudah ditutup. Buka kembali untuk membalas."
    : "Percakapan akan aktif setelah agen mengirim pesan pertama.";

  const ticketAttachments = await signAttachments(ticket.attachments);

  const justCreated = query.created === "1";
  const justClosed = query.closed === "1";

  return (
    <>
      <PageHead
        title={ticket.subject}
        sub={`Kode tiket ${ticket.ticket_code}`}
        crumbs={[
          { label: "Tiket Saya", href: "/dashboard/tickets" },
          { label: ticket.ticket_code },
        ]}
      >
        <Link className="btn btn--ghost" href="/dashboard/tickets">
          Semua tiket
        </Link>
        <ConversationDrawer
          ticketId={ticket.id}
          messages={messages}
          viewer={{ id: session.userId, role: "user" }}
          canPost={canPost}
          closedNotice={closedNotice}
        />
      </PageHead>

      {justCreated && (
        <p className="form-note form-note--ok" style={{ marginBottom: "var(--gap)" }}>
          Tiket berhasil dibuat. Prioritas <strong>{ticket.urgency}</strong> dengan
          target penyelesaian <strong>{formatDateTime(ticket.sla_deadline)}</strong>.
        </p>
      )}

      {justClosed && ticket.status === "Closed" && (
        <p className="form-note form-note--ok" style={{ marginBottom: "var(--gap)" }}>
          Terima kasih — tiket sudah ditutup.
        </p>
      )}

      <div className="split">
        <div className="stack">
          <section className="card">
            <h2 className="card__title">Keluhan Anda</h2>
            <p className="msg__text mt-2" style={{ whiteSpace: "pre-wrap" }}>
              {ticket.description}
            </p>
            <AttachmentStrip items={ticketAttachments} />
          </section>

          {ticket.status === "Waiting Validation" && (
            <ValidationPanel ticketId={ticket.id} />
          )}

          <section className="card">
            <div className="card__head">
              <h2 className="card__title">Percakapan</h2>
              <span className="chip">{messages.length} pesan</span>
            </div>
            <p className="copy mt-2">
              {canPost
                ? "Diskusi tiket ini dibuka di panel samping. Buka lewat tombol Percakapan di atas untuk membaca dan membalas."
                : isClosed
                  ? "Tiket sudah ditutup. Buka kembali tiket untuk melanjutkan percakapan."
                  : "Percakapan akan aktif setelah agen mengirim pesan pertama. Anda tetap dapat memantau status tiket di halaman ini."}
            </p>
          </section>
        </div>

        <aside className="side">
          <section className="card">
            <div className="row row--between">
              <StatusPill status={ticket.status} />
              <UrgencyPill urgency={ticket.urgency} />
            </div>

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
                <dt>Dibuat</dt>
                <dd>{formatDateTime(ticket.created_at)}</dd>
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
            </dl>

            {ticket.status === "Closed" && (
              <>
                <hr className="hair" />
                <p className="copy">Kepuasan Anda atas penanganan ini</p>
                <div className="mt-1">
                  <Rating score={ticket.csat_score} />
                </div>
                <div className="mt-2 stack--sm">
                  <CsatModal
                    ticketId={ticket.id}
                    ticketCode={ticket.ticket_code}
                    alreadyScored={ticket.csat_score}
                  />
                  <ReopenButton ticketId={ticket.id} />
                </div>
              </>
            )}
          </section>

          <section className="card">
            <h2 className="card__title">Agen penanggung jawab</h2>
            {agent ? (
              <div className="row row--center mt-2">
                <Avatar name={agent.full_name} tint={agent.avatar_tint} size="lg" />
                <div>
                  <p className="pitem__name">{agent.full_name}</p>
                  <p className="pitem__due">{agent.email}</p>
                </div>
              </div>
            ) : (
              <p className="copy mt-2">
                Belum ada agen yang mengambil tiket ini. Tim frontline akan
                segera menanganinya.
              </p>
            )}
          </section>

          {(ticket.transaction_ref || ticket.transaction_amount) && (
            <section className="card">
              <h2 className="card__title">Transaksi terkait</h2>
              <dl className="dl mt-2">
                <div>
                  <dt>Referensi</dt>
                  <dd className="code-ref">{ticket.transaction_ref ?? "—"}</dd>
                </div>
                <div>
                  <dt>Tanggal</dt>
                  <dd>{formatDate(ticket.transaction_date)}</dd>
                </div>
                <div>
                  <dt>Nilai</dt>
                  <dd>{formatCurrency(ticket.transaction_amount)}</dd>
                </div>
              </dl>
            </section>
          )}

          {(events ?? []).length > 0 && (
            <section className="card">
              <details className="audit">
                <summary className="audit__summary">
                  <span className="card__title">Riwayat tiket</span>
                  <span className="audit__hint">{(events ?? []).length} pembaruan</span>
                </summary>
                <ol className="timeline mt-2">
                  {(events ?? []).map((e) => (
                    <li className="tl-item" key={e.id}>
                      <span className="tl-item__dot" />
                      <div className="tl-item__body">
                        <p className="tl-item__title">
                          {e.event_type === "created"
                            ? "Tiket dibuat"
                            : e.event_type === "escalated"
                              ? `Eskalasi ${e.from_value} → ${e.to_value}`
                              : e.event_type === "assigned"
                                ? `Ditugaskan ke ${e.to_value}`
                                : e.event_type === "csat"
                                  ? `Survei kepuasan: ${e.to_value}/5`
                                  : e.event_type === "knowledge_published"
                                    ? "Diarsipkan ke knowledge base"
                                    : e.event_type === "message"
                                      ? `Pesan baru dari ${e.to_value === "agent" ? "agen" : "pelanggan"}`
                                      : `Status: ${e.from_value} → ${e.to_value}`}
                        </p>
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
