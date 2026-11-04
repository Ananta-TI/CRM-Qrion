import { PageHead, StatCard } from "@/components/ui";
import { requireStaff } from "@/lib/auth/session";
import { formatDuration } from "@/lib/domain/tickets";
import { createClient } from "@/lib/supabase/server";
import { URGENCY_RANK } from "@/lib/domain/tickets";
import type { UrgencyLevel } from "@/lib/types/database";

export const metadata = { title: "Analitik" };

export default async function AnalyticsPage() {
  // Back-office only: the layout checks for a session, this checks the role.
  await requireStaff();
  const supabase = await createClient();

  const { data: rows } = await supabase.from("ticket_knowledge").select("*");
  const all = rows ?? [];

  const closed = all.filter((r) => r.status === "Closed");
  const open = all.filter((r) => r.status !== "Closed");

  // --- headline numbers -------------------------------------------------
  const withHours = closed.filter((r) => r.hours_to_close !== null);
  const avgHours =
    withHours.length > 0
      ? withHours.reduce((s, r) => s + Number(r.hours_to_close), 0) / withHours.length
      : null;

  const withCsat = closed.filter((r) => r.csat_score !== null);
  const avgCsat =
    withCsat.length > 0
      ? withCsat.reduce((s, r) => s + (r.csat_score ?? 0), 0) / withCsat.length
      : null;

  const onTime = closed.filter((r) => !r.sla_breached).length;
  const slaRate = closed.length > 0 ? Math.round((onTime / closed.length) * 100) : 0;
  const reopenRate =
    all.length > 0
      ? Math.round((all.filter((r) => r.reopen_count > 0).length / all.length) * 100)
      : 0;

  // --- distribution by urgency ------------------------------------------
  const urgencies: UrgencyLevel[] = ["Critical", "High", "Medium", "Low"];
  const byUrgency = urgencies.map((u) => ({
    urgency: u,
    total: all.filter((r) => r.urgency === u).length,
    open: open.filter((r) => r.urgency === u).length,
  }));
  const maxUrgency = Math.max(...byUrgency.map((b) => b.total), 1);

  // --- 30 day throughput -------------------------------------------------
  const days: { label: string; created: number; closed: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);

    days.push({
      label: day.toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
      created: all.filter((r) => {
        const t = new Date(r.created_at).getTime();
        return t >= day.getTime() && t < next.getTime();
      }).length,
      closed: all.filter((r) => {
        if (!r.closed_at) return false;
        const t = new Date(r.closed_at).getTime();
        return t >= day.getTime() && t < next.getTime();
      }).length,
    });
  }
  const maxDay = Math.max(...days.map((d) => Math.max(d.created, d.closed)), 1);

  // --- escalation mix ----------------------------------------------------
  const escalationCounts = (["L1", "L2", "L3"] as const).map((l) => ({
    level: l,
    total: all.filter((r) => r.escalation_level === l).length,
  }));

  return (
    <>
      <PageHead
        title="Analitik"
        sub="Bagaimana tim menangani keluhan, dan di mana waktu terbuang."
      />

      <div className="grid">
        <StatCard
          title="Total tiket"
          value={all.length}
          note={`${open.length} masih aktif`}
        />
        <StatCard
          title="Rata-rata penyelesaian"
          value={avgHours === null ? "—" : formatDuration(avgHours)}
          note="Dari dibuat sampai ditutup"
        />
        <StatCard
          title="Tepat waktu SLA"
          value={`${slaRate}%`}
          note={`${onTime} dari ${closed.length} tiket`}
        />
        <StatCard
          title="Rata-rata CSAT"
          value={avgCsat === null ? "—" : avgCsat.toFixed(1)}
          note={`Reopen rate ${reopenRate}%`}
        />
      </div>

      <div className="split mt-3">
        <section className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Volume 30 hari terakhir</h2>
              <p className="card__sub">
                Tiket masuk dibanding tiket yang berhasil ditutup
              </p>
            </div>
            <ul className="legend">
              <li>
                <span className="sw sw--prog" /> Masuk
              </li>
              <li>
                <span className="sw sw--done" /> Ditutup
              </li>
            </ul>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 4,
              height: 180,
              marginTop: 20,
            }}
          >
            {days.map((d) => (
              <div
                key={d.label}
                style={{ flex: 1, display: "flex", gap: 2, alignItems: "flex-end", height: "100%" }}
                title={`${d.label}: ${d.created} masuk, ${d.closed} ditutup`}
              >
                <span
                  className="sla-bar__fill sla-bar__fill--ok"
                  style={{
                    flex: 1,
                    height: `${Math.max((d.created / maxDay) * 100, 2)}%`,
                    background: "var(--g-400)",
                    borderRadius: 4,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    height: `${Math.max((d.closed / maxDay) * 100, 2)}%`,
                    background: "var(--g-600)",
                    borderRadius: 4,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="sla-note" style={{ marginTop: 8 }}>
            <span>{days[0]?.label}</span>
            <span>{days[days.length - 1]?.label}</span>
          </div>
        </section>

        <div className="side">
          <section className="card">
            <h2 className="card__title">Distribusi prioritas</h2>
            <ul className="stack--sm mt-2">
              {byUrgency.map((b) => (
                <li key={b.urgency}>
                  <div className="row row--between" style={{ fontSize: 13 }}>
                    <span>{b.urgency}</span>
                    <span className="copy">
                      {b.total} total · {b.open} aktif
                    </span>
                  </div>
                  <div className="sla-bar" style={{ marginTop: 6 }}>
                    <div
                      className={`sla-bar__fill ${
                        URGENCY_RANK[b.urgency] >= 3
                          ? "sla-bar__fill--breached"
                          : URGENCY_RANK[b.urgency] === 2
                            ? "sla-bar__fill--soon"
                            : "sla-bar__fill--ok"
                      }`}
                      style={{ width: `${Math.round((b.total / maxUrgency) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2 className="card__title">Sebaran level</h2>
            <dl className="dl mt-2">
              {escalationCounts.map((e) => (
                <div key={e.level}>
                  <dt>{e.level}</dt>
                  <dd>{e.total} tiket</dd>
                </div>
              ))}
            </dl>
            <p className="copy mt-2">
              Eskalasi tinggi menandakan frontline perlu panduan tambahan.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
