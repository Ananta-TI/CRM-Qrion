import Link from "next/link";

import { PageHead, Rating, StatCard, StatusPill, UrgencyPill } from "@/components/ui";
import { IconFlag, IconPlus } from "@/components/icons";
import { requireStaff, viewerId } from "@/lib/auth/session";
import { greetingName } from "@/lib/domain/people";
import { relativeTime, slaState } from "@/lib/domain/tickets";
import { createClient } from "@/lib/supabase/server";
import type { Ticket } from "@/lib/types/database";

export const metadata = { title: "Ringkasan Programmer" };

export default async function AgentHome() {
  const supabase = await createClient();
  const viewerPromise = viewerId();

  const sessionsPromise = requireStaff();

  // The queue read keys off the proxy-verified id, so it does not wait for the
  // profile lookup.
  const ticketsPromise = (async () => {
    const viewer = await viewerPromise;
    if (!viewer) return { data: [] as Ticket[] };

    return supabase
      .from("tickets")
      .select("*")
      .or(`assignee_id.is.null,assignee_id.eq.${viewer}`)
      .order("created_at", { ascending: false });
  })();

  const [session, { data: tickets }] = await Promise.all([
    sessionsPromise,
    ticketsPromise,
  ]);

  const rows = tickets ?? [];

  const open = rows.filter((t) => t.status === "Open");
  const active = rows.filter((t) => t.status === "In Progress");
  const waiting = rows.filter((t) => t.status === "Waiting Validation");
  const closed = rows.filter((t) => t.status === "Closed");
  const breached = rows.filter((t) => t.sla_breached && t.status !== "Closed");
  const mine = rows.filter((t) => t.assignee_id === session.userId && t.status !== "Closed");

  // The queue an agent should work next: unassigned or breached, earliest
  // deadline first.
  const queue = rows
    .filter((t) => t.status !== "Closed" && t.status !== "Waiting Validation")
    .sort((a, b) => {
      const aBreach = a.sla_breached ? 0 : 1;
      const bBreach = b.sla_breached ? 0 : 1;
      if (aBreach !== bBreach) return aBreach - bBreach;
      return (
        new Date(a.sla_deadline ?? 0).getTime() - new Date(b.sla_deadline ?? 0).getTime()
      );
    })
    .slice(0, 6);

  const scored = closed.filter((t) => t.csat_score !== null);
  const csat =
    scored.length > 0
      ? scored.reduce((sum, t) => sum + (t.csat_score ?? 0), 0) / scored.length
      : null;

  const slaMet = closed.filter((t) => !t.sla_breached).length;
  const slaRate = closed.length > 0 ? Math.round((slaMet / closed.length) * 100) : 0;

  return (
    <>
      <PageHead
        title={`Selamat datang, ${greetingName(session.profile.full_name)}`}
        sub="Antrian keluhan dan kesehatan SLA tim Anda hari ini."
      >
        <Link className="btn btn--ghost" href="/agent/board">
          Buka board <IconPlus />
        </Link>
      </PageHead>

      {breached.length > 0 && (
        <div className="banner banner--warn" style={{ marginBottom: "var(--gap)" }}>
          <span className="promo__icon" style={{ background: "var(--rose)", color: "#fff" }}>
            <IconFlag />
          </span>
          <div className="banner__text">
            <p className="banner__title">
              {breached.length} tiket melewati target SLA
            </p>
            <p className="banner__sub">
              Prioritas tertinggi — tangani sebelum pegawai menghubungi ulang.
            </p>
          </div>
          <Link className="btn btn--warn btn--sm" href="/agent/board">
            Lihat tiket
          </Link>
        </div>
      )}

      <div className="grid">
        <StatCard title="Tiket Baru" value={open.length} note="Belum diambil programmer" href="/agent/board" />
        <StatCard title="Sedang Diproses" value={active.length} note="Ditangani programmer" href="/agent/board" />
        <StatCard title="Menunggu Pegawai" value={waiting.length} note="Validasi solusi" href="/agent/board" />
        <StatCard
          title="Tugas Saya"
          value={mine.length}
          note={mine.length ? "Sedang Anda tangani" : "Tidak ada beban aktif"}
          href="/agent/board"
        />
      </div>

      <div className="split mt-3">
        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Antrian prioritas</h2>
            <Link className="link-btn" href="/agent/board">
              Lihat board
            </Link>
          </div>

          {queue.length === 0 ? (
            <p className="empty">
              Tidak ada tiket aktif. Antrian bersih.
            </p>
          ) : (
            <div className="tbl__wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Subjek</th>
                    <th>Prioritas</th>
                    <th>Status</th>
                    <th>Batas SLA</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link className="link-btn" href={`/agent/tickets/${t.id}`} prefetch={false}>
                          {t.ticket_code}
                        </Link>
                      </td>
                      <td style={{ maxWidth: 280 }}>
                        <Link className="pitem__name" href={`/agent/tickets/${t.id}`} prefetch={false}>
                          {t.subject}
                        </Link>
                        <span className="pitem__due">{t.category}</span>
                      </td>
                      <td>
                        <UrgencyPill urgency={t.urgency} />
                      </td>
                      <td>
                        <StatusPill status={t.status} />
                      </td>
                      <td>
                        <span
                          className={
                            t.sla_breached ? "sla-note--breached" : "copy"
                          }
                          style={{ fontSize: 12.5 }}
                        >
                          {slaState({
                            createdAt: t.created_at,
                            deadline: t.sla_deadline,
                            status: t.status,
                            breached: t.sla_breached,
                          }).label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="side">
          <section className="card">
            <h2 className="card__title">Kesehatan SLA</h2>
            <div className="gauge">
              <svg className="gauge__svg" viewBox="0 0 260 142" aria-hidden="true">
                <path
                  className="gauge__track"
                  d="M32 120a98 98 0 0 1 196 0"
                  pathLength={100}
                />
                <path
                  className="gauge__seg gauge__seg--done"
                  d="M32 120a98 98 0 0 1 196 0"
                  pathLength={100}
                  strokeDasharray={`${slaRate} ${100 - slaRate}`}
                />
              </svg>
              <p className="gauge__read">
                <span className="gauge__pct">{slaRate}%</span>
                <span className="gauge__lbl">Tiket tertutup tepat waktu</span>
              </p>
            </div>
            <ul className="legend mt-2" style={{ justifyContent: "center" }}>
              <li>
                <span className="sw sw--done" /> Tepat waktu {slaMet}
              </li>
              <li>
                <span className="sw sw--crit" /> Terlampaui {closed.length - slaMet}
              </li>
            </ul>
          </section>

          <section className="card">
            <h2 className="card__title">Kepuasan pegawai</h2>
            {csat === null ? (
              <p className="copy mt-1">Belum ada survei yang diisi.</p>
            ) : (
              <>
                <p className="stat__num" style={{ fontSize: 34 }}>
                  {csat.toFixed(1)}
                  <span style={{ fontSize: 16, color: "var(--faint)" }}>/5</span>
                </p>
                <div className="mt-1">
                  <Rating score={Math.round(csat)} />
                </div>
                <p className="copy mt-1">Dari {scored.length} survei terisi.</p>
              </>
            )}
          </section>

          <section className="card">
            <h2 className="card__title">Tiket terbaru</h2>
            <ul className="tlist">
              {rows.slice(0, 5).map((t) => (
                <li className="titem" key={t.id}>
                  <span className="titem__body">
                    <Link className="titem__name" href={`/agent/tickets/${t.id}`} prefetch={false}>
                      {t.subject}
                    </Link>
                    <span className="titem__task">{relativeTime(t.created_at)}</span>
                  </span>
                  <StatusPill status={t.status} />
                </li>
              ))}
              {rows.length === 0 && <p className="empty">Belum ada tiket.</p>}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
