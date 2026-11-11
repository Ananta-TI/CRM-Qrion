import {
  AreaChart,
  BarList,
  Columns,
  Donut,
  Gauge,
  Heatmap,
} from "@/components/charts";
import { PageHead, StatCard } from "@/components/ui";
import { requireStaff, viewerId } from "@/lib/auth/session";
import {
  STATUSES,
  TICKET_CATEGORIES,
  URGENCY_STYLE,
  formatDuration,
} from "@/lib/domain/tickets";
import { createClient } from "@/lib/supabase/server";
import type {
  TicketCategory,
  TicketStatus,
  UrgencyLevel,
} from "@/lib/types/database";

export const metadata = { title: "Analitik" };

type AnalyticsTicket = {
  status: TicketStatus;
  urgency: UrgencyLevel;
  category: TicketCategory;
  csat_score: number | null;
  reopen_count: number;
  created_at: string;
  first_response_at: string | null;
  closed_at: string | null;
  sla_breached: boolean;
  sla_paused_minutes: number;
  assignee_id: string | null;
};

/** Status colours mirror the status pills, so the chart is self-explanatory. */
const STATUS_COLOR: Record<TicketStatus, string> = {
  Open: "var(--slate)",
  "In Progress": "var(--sky)",
  "Waiting Validation": "var(--amber)",
  Closed: "var(--teal)",
};

const HOURS = 3_600_000;

export default async function AnalyticsPage() {
  const supabase = await createClient();

  // Both branches start immediately. The id comes from the proxy's verified JWT
  // claim (no round-trip), so the ticket read no longer has to queue behind the
  // profile lookup — worth ~300ms of the ~1.2s a navigation used to cost.
  const viewerPromise = viewerId();

  // Back-office only: the layout checks for a session, this checks the role.
  const sessionPromise = requireStaff();

  // The Knowledge Base view is gone; read the tickets this programmer may see
  // (assigned to them plus the shared queue) and derive the same aggregates.
  const rowsPromise = (async () => {
    const viewer = await viewerPromise;
    if (!viewer) return { data: null };

    return supabase
      .from("tickets")
      .select(
        "status, urgency, category, csat_score, reopen_count, created_at, first_response_at, closed_at, sla_breached, sla_paused_minutes, assignee_id",
      )
      .or(`assignee_id.is.null,assignee_id.eq.${viewer}`);
  })();

  const [session, { data: rows }] = await Promise.all([sessionPromise, rowsPromise]);

  const all = (rows ?? []) as AnalyticsTicket[];

  const open = all.filter((r) => r.status !== "Closed");
  const closedRows = all.filter((r) => r.status === "Closed");
  const closed = closedRows.map((r) => ({
    ...r,
    hours_to_close: r.closed_at
      ? (new Date(r.closed_at).getTime() - new Date(r.created_at).getTime()) / HOURS -
        (r.sla_paused_minutes ?? 0) / 60
      : null,
  }));

  // --- headline numbers -------------------------------------------------
  const withHours = closed.filter((r) => r.hours_to_close !== null);
  const avgHours =
    withHours.length > 0
      ? withHours.reduce((s, r) => s + Number(r.hours_to_close), 0) / withHours.length
      : null;

  const sortedHours = withHours
    .map((r) => Number(r.hours_to_close))
    .sort((a, b) => a - b);
  const medianHours =
    sortedHours.length > 0
      ? sortedHours[Math.floor(sortedHours.length / 2)]
      : null;

  const withCsat = closed.filter((r) => r.csat_score !== null);
  const avgCsat =
    withCsat.length > 0
      ? withCsat.reduce((s, r) => s + (r.csat_score ?? 0), 0) / withCsat.length
      : null;

  const onTime = closed.filter((r) => !r.sla_breached).length;
  const breached = closed.length - onTime;
  const slaRate = closed.length > 0 ? Math.round((onTime / closed.length) * 100) : 0;

  const reopened = all.filter((r) => r.reopen_count > 0).length;
  const reopenRate =
    all.length > 0 ? Math.round((reopened / all.length) * 100) : 0;

  // First response: only tickets the team actually answered.
  const answered = all.filter((r) => r.first_response_at);
  const avgFirst =
    answered.length > 0
      ? answered.reduce(
          (s, r) =>
            s +
            Math.max(
              0,
              (new Date(r.first_response_at as string).getTime() -
                new Date(r.created_at).getTime()) /
                HOURS,
            ),
          0,
        ) / answered.length
      : null;

  const mine = all.filter((r) => r.assignee_id === session.userId).length;
  const shared = all.filter((r) => r.assignee_id === null).length;

  // --- distribution by status -------------------------------------------
  const byStatus = STATUSES.map((status) => ({
    label: status,
    value: all.filter((r) => r.status === status).length,
    color: STATUS_COLOR[status],
  }));

  // --- distribution by category -----------------------------------------
  const byCategory = TICKET_CATEGORIES.map((category) => ({
    label: category,
    value: all.filter((r) => r.category === category).length,
  }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);

  // --- distribution by urgency ------------------------------------------
  const urgencies: UrgencyLevel[] = ["Critical", "High", "Medium", "Low"];
  const byUrgency = urgencies.map((u) => ({
    urgency: u,
    total: all.filter((r) => r.urgency === u).length,
    open: open.filter((r) => r.urgency === u).length,
  }));
  const maxUrgency = Math.max(...byUrgency.map((b) => b.total), 1);

  // --- CSAT histogram ----------------------------------------------------
  const csatBuckets = [1, 2, 3, 4, 5].map((score) => ({
    label: `${score}★`,
    value: closed.filter((r) => Math.round(r.csat_score ?? 0) === score).length,
    color:
      score <= 2 ? "var(--rose)" : score === 3 ? "var(--amber)" : "var(--teal)",
  }));

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
  const created30 = days.reduce((s, d) => s + d.created, 0);
  const closed30 = days.reduce((s, d) => s + d.closed, 0);

  // --- when do tickets arrive -------------------------------------------
  // Monday-first weekday axis × six 4-hour blocks: the shape of the work week.
  const heatRows = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
  const heatCols = ["00", "04", "08", "12", "16", "20"];
  const heat: number[][] = heatRows.map(() => heatCols.map(() => 0));
  let peak = { label: "—", value: 0 };
  for (const r of all) {
    const d = new Date(r.created_at);
    const wd = (d.getDay() + 6) % 7;
    const bucket = Math.min(5, Math.floor(d.getHours() / 4));
    heat[wd][bucket] += 1;
    if (heat[wd][bucket] > peak.value) {
      peak = {
        label: `${heatRows[wd]} ${heatCols[bucket]}:00–${(bucket + 1) * 4}:00`,
        value: heat[wd][bucket],
      };
    }
  }
  const heatMax = Math.max(1, ...heat.flat());

  return (
    <>
      <PageHead
        title="Analitik"
        sub="Bagaimana tiket yang Anda tangani dan antrian bersama bergerak."
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
                <span className="sw" style={{ ["--c" as string]: "var(--chart)" }} />{" "}
                Masuk
              </li>
              <li>
                <span
                  className="sw"
                  style={{ ["--c" as string]: "var(--chart-2)" }}
                />{" "}
                Ditutup
              </li>
            </ul>
          </div>

          <AreaChart
            labels={days.map((d) => d.label)}
            series={[
              {
                label: "Masuk",
                color: "var(--chart)",
                values: days.map((d) => d.created),
                area: true,
              },
              {
                label: "Ditutup",
                color: "var(--chart-2)",
                values: days.map((d) => d.closed),
              },
            ]}
            unit="tiket"
          />

          <div className="chart__summary">
            <span>
              <b>{created30}</b> tiket masuk
            </span>
            <span>
              <b>{closed30}</b> tiket ditutup
            </span>
            <span>
              <b>{Math.round((created30 / days.length) * 10) / 10}</b> rata-rata masuk
              per hari
            </span>
          </div>
        </section>

        <aside className="side">
          <section className="card">
            <h2 className="card__title">Status tiket</h2>
            <p className="card__sub">Seluruh tiket yang Anda lihat</p>
            <div className="mt-2">
              <Donut data={byStatus} centerValue={all.length} centerLabel="tiket" />
            </div>
          </section>

          <section className="card">
            <h2 className="card__title">Kesehatan SLA</h2>
            <Gauge
              pct={slaRate}
              label="Tiket tertutup tepat waktu"
              caption={`${onTime} dari ${closed.length} tiket tertutup`}
            />
            <ul className="legend mt-2" style={{ justifyContent: "center" }}>
              <li>
                <span className="sw sw--done" /> Tepat waktu {onTime}
              </li>
              <li>
                <span className="sw sw--crit" /> Terlampaui {breached}
              </li>
            </ul>
          </section>
        </aside>
      </div>

      <div className="charts mt-3">
        <section className="card">
          <h2 className="card__title">Kategori</h2>
          <p className="card__sub">Tiket menurut kategori keluhan</p>
          <div className="mt-2">
            {byCategory.length > 0 ? (
              <BarList items={byCategory} />
            ) : (
              <p className="empty">Belum ada tiket.</p>
            )}
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">Prioritas</h2>
          <p className="card__sub">Masih aktif dibanding yang sudah selesai</p>
          <div className="stackbars">
            {byUrgency.map((b) => (
              <div className="stackbars__row" key={b.urgency}>
                <span className="stackbars__label">{b.urgency}</span>
                <span className="stackbars__track">
                  <span
                    className={`stackbars__fill ${URGENCY_STYLE[b.urgency].dot}`}
                    style={{ width: `${(b.open / maxUrgency) * 100}%` }}
                    title={`${b.open} aktif`}
                  />
                  <span
                    className="stackbars__fill stackbars__fill--rest"
                    style={{ width: `${((b.total - b.open) / maxUrgency) * 100}%` }}
                    title={`${b.total - b.open} selesai`}
                  />
                </span>
                <span className="stackbars__val">{b.total}</span>
              </div>
            ))}
          </div>
          <ul className="legend mt-2">
            <li>
              <span className="sw sw--prog" /> Aktif {open.length}
            </li>
            <li>
              <span
                className="sw"
                style={{ ["--c" as string]: "var(--line-2)" }}
              />{" "}
              Selesai {closedRows.length}
            </li>
          </ul>
        </section>

        <section className="card">
          <h2 className="card__title">Distribusi CSAT</h2>
          <p className="card__sub">
            {withCsat.length > 0
              ? `Dari ${withCsat.length} survei terisi`
              : "Tingkat kepuasan pelanggan"}
          </p>
          {withCsat.length > 0 ? (
            <>
              <Columns items={csatBuckets} />
              <p className="sla-note" style={{ marginTop: 10 }}>
                <span>1★ tidak puas</span>
                <span>5★ sangat puas</span>
              </p>
            </>
          ) : (
            <p className="empty">Belum ada survei yang diisi.</p>
          )}
        </section>
      </div>

      <div className="split mt-3">
        <section className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Jam sibuk</h2>
              <p className="card__sub">
                Kapan tiket masuk, per hari dan blok empat jam
              </p>
            </div>
            {peak.value > 0 && (
              <span className="tag">
                Puncak {peak.label} · {peak.value} tiket
              </span>
            )}
          </div>

          <Heatmap rows={heatRows} cols={heatCols} values={heat} max={heatMax} />

          <div className="heat__scale">
            <span>Sepi</span>
            {[0, 0.25, 0.5, 0.75, 1].map((step) => (
              <i
                key={step}
                style={{
                  background:
                    step === 0
                      ? "var(--well)"
                      : `color-mix(in srgb, var(--iris) ${Math.round(step * 100)}%, var(--well))`,
                }}
              />
            ))}
            <span>Padat</span>
          </div>
        </section>

        <aside className="side">
          <section className="card">
            <h2 className="card__title">Ringkasan operasional</h2>
            <dl className="dl mt-2">
              <div>
                <dt>Respons pertama</dt>
                <dd>{avgFirst === null ? "—" : formatDuration(avgFirst)}</dd>
              </div>
              <div>
                <dt>Median penyelesaian</dt>
                <dd>{medianHours === null ? "—" : formatDuration(medianHours)}</dd>
              </div>
              <div>
                <dt>Pernah dibuka ulang</dt>
                <dd>
                  {reopened}{" "}
                  <span className="copy" style={{ fontSize: "var(--fs-xs)" }}>
                    ({reopenRate}%)
                  </span>
                </dd>
              </div>
              <div>
                <dt>Melewati SLA</dt>
                <dd>{all.filter((r) => r.sla_breached).length}</dd>
              </div>
              <div>
                <dt>Ditangani saya</dt>
                <dd>{mine}</dd>
              </div>
              <div>
                <dt>Antrian bersama</dt>
                <dd>{shared}</dd>
              </div>
              <div>
                <dt>Beban aktif</dt>
                <dd>
                  {open.length}{" "}
                  <span className="copy" style={{ fontSize: "var(--fs-xs)" }}>
                    dari {all.length} tiket
                  </span>
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}
