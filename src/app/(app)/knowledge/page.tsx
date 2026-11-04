import Link from "next/link";

import { Empty, PageHead, Rating, StatCard } from "@/components/ui";
import { IconChat, IconMail, IconSearch } from "@/components/icons";
import { isStaff, requireSession } from "@/lib/auth/session";
import { SLA_POLICY, STATUS_TRANSITIONS, formatDate, formatDuration } from "@/lib/domain/tickets";
import { createClient } from "@/lib/supabase/server";
import type { TicketCategory } from "@/lib/types/database";

export const metadata = { title: "Knowledge Base" };

const FAQ = [
  {
    q: "Bagaimana tiket saya ditentukan prioritasnya?",
    a: "Saat Anda mengirim keluhan, sistem membaca kata kunci dan kategori untuk menilai dampaknya. Keluhan terkait pembayaran, atau yang menyebut kehilangan dana dan akses akun, otomatis naik ke High atau Critical. Agen akan memverifikasi prioritas tersebut.",
  },
  {
    q: "Kapan percakapan tiket aktif?",
    a: "Percakapan aktif setelah agen mengirim pesan pertama. Sebelum itu, Anda tetap bisa memantau status dan detail tiket, tetapi kolom balasan dikunci agar tidak ada percakapan yang menggantung tanpa penanganan.",
  },
  {
    q: "Apa itu eskalasi L1, L2, dan L3?",
    a: "L1 adalah frontline yang menangani keluhan umum. Bila butuh penanganan teknis mendalam, tiket naik ke L2. Bila menyangkut kebijakan atau dampak besar, tiket naik ke L3 (manajemen). Setiap kenaikan level memperpendek target SLA.",
  },
  {
    q: "Saya sudah ditawari solusi, tapi belum beres. Apa yang harus saya lakukan?",
    a: "Pilih tombol “Belum Selesai” dan jelaskan apa yang masih kurang. Tiket otomatis kembali ke agen dengan status In Progress, dan Anda tidak perlu membuat tiket baru.",
  },
  {
    q: "Kapan saya bisa mengisi survei kepuasan?",
    a: "Survei tersedia setelah tiket ditutup, dan bisa diisi kapan saja dari halaman tiket. Survei tidak terbuka otomatis, jadi Anda bisa menyelesaikannya tanpa terpotong dialog.",
  },
  {
    q: "Apakah catatan internal bisa saya lihat?",
    a: "Tidak. Catatan internal hanya terlihat oleh agen dan manajer, agar mereka bisa berkoordinasi tanpa membingungkan pelanggan.",
  },
];

export default async function KnowledgePage({
  searchParams,
}: PageProps<"/knowledge">) {
  const session = await requireSession();
  const staff = isStaff(session.profile.role);
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const category = typeof params.category === "string" ? params.category : "all";

  const supabase = await createClient();

  // The view already joins customer/agent names and is RLS-filtered.
  let query = supabase
    .from("ticket_knowledge")
    .select("*")
    .order("closed_at", { ascending: false, nullsFirst: false });

  if (q) {
    query = query.or(`subject.ilike.%${q}%,description.ilike.%${q}%,resolution_summary.ilike.%${q}%`);
  }
  if (category !== "all") {
    query = query.eq("category", category as TicketCategory);
  }

  const { data: entries } = await query;
  const rows = entries ?? [];

  // Staff-only reporting. Customers still get the searchable article list.
  const { data: allRows } = await supabase
    .from("ticket_knowledge")
    .select(
      "category, urgency, csat_score, hours_to_close, sla_breached, status, reopen_count",
    );

  const all = allRows ?? [];
  const closed = all.filter((r) => r.status === "Closed");
  const withCsat = closed.filter((r) => r.csat_score !== null);
  const avgCsat =
    withCsat.length > 0
      ? withCsat.reduce((s, r) => s + (r.csat_score ?? 0), 0) / withCsat.length
      : null;

  const withHours = closed.filter((r) => r.hours_to_close !== null);
  const avgHours =
    withHours.length > 0
      ? withHours.reduce((s, r) => s + Number(r.hours_to_close), 0) / withHours.length
      : null;

  const onTime = closed.filter((r) => !r.sla_breached).length;
  const slaRate = closed.length > 0 ? Math.round((onTime / closed.length) * 100) : 0;
  const reopenRate =
    closed.length > 0
      ? Math.round((closed.filter((r) => r.reopen_count > 0).length / closed.length) * 100)
      : 0;

  // Top categories by frequency.
  const byCategory = new Map<string, number>();
  for (const row of all) {
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + 1);
  }
  const topCategories = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxCount = topCategories[0]?.[1] ?? 1;

  return (
    <>
      <PageHead
        title="Knowledge Base"
        sub="Arsip resolusi keluhan masa lalu, panduan status, dan jawaban umum."
      />

      {staff && (
        <div className="grid">
          <StatCard
            title="Total Terarsip"
            value={all.length}
            note="Seluruh tiket tercatat"
          />
          <StatCard
            title="Rata-rata Penyelesaian"
            value={avgHours === null ? "—" : formatDuration(avgHours)}
            note="Dari pembuatan sampai tutup"
          />
          <StatCard
            title="Tepat Waktu SLA"
            value={`${slaRate}%`}
            note={`${onTime} dari ${closed.length} tiket tertutup`}
          />
          <StatCard
            title="Rata-rata CSAT"
            value={avgCsat === null ? "—" : avgCsat.toFixed(1)}
            note={`${withCsat.length} survei terisi`}
          />
        </div>
      )}

      <div className="split mt-3">
        <section className="card">
          <div className="card__head">
            <h2 className="card__title">
              {q || category !== "all"
                ? `${rows.length} hasil ditemukan`
                : "Resolusi terbaru"}
            </h2>
            <Link className="link-btn" href="/knowledge">
              Reset filter
            </Link>
          </div>

          <form className="search mt-2" role="search" action="/knowledge" style={{ flex: "none" }}>
            <label className="sr-only" htmlFor="kb-search">
              Cari resolusi
            </label>
            <IconSearch className="search__icon" />
            <input
              id="kb-search"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Cari keluhan atau solusi…"
              autoComplete="off"
            />
            {category !== "all" && (
              <input type="hidden" name="category" value={category} />
            )}
          </form>

          {rows.length === 0 ? (
            <Empty>
              Tidak ada arsip yang cocok. Coba kata kunci lain
              {staff ? ", atau kirim solusi dari halaman tiket." : "."}
            </Empty>
          ) : (
            <div className="kb-grid mt-2">
              {rows.map((entry) => (
                <article className="kb-card" key={entry.id}>
                  <div className="row row--between">
                    <span className="code-ref">{entry.ticket_code}</span>
                    <Rating score={entry.csat_score} />
                  </div>

                  <h3 className="kb-card__title">{entry.subject}</h3>

                  <p className="kb-card__body">
                    {entry.resolution_summary ?? entry.description}
                  </p>

                  <div className="tag-row">
                    <span className="tag">{entry.category}</span>
                    <span className="tag">{entry.urgency}</span>
                    <span className="tag">{entry.escalation_level}</span>
                    {entry.tags
                      .filter((t) => t !== entry.category.toLowerCase())
                      .slice(0, 3)
                      .map((t) => (
                        <span className="tag" key={t}>
                          {t}
                        </span>
                      ))}
                  </div>

                  <hr className="hair" style={{ margin: "6px 0" }} />

                  <div className="detail__meta" style={{ marginTop: 0 }}>
                    <span>
                      Ditutup {entry.closed_at ? formatDate(entry.closed_at) : "—"}
                    </span>
                    <span>
                      {entry.hours_to_close !== null
                        ? `Selesai dalam ${formatDuration(Number(entry.hours_to_close))}`
                        : "Durasi tidak tercatat"}
                    </span>
                    {entry.sla_breached && <span className="sla-note--breached">Lewat SLA</span>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="side">
          {staff && (
            <section className="card">
              <h2 className="card__title">Kategori tersering</h2>
              <ul className="stack--sm mt-2">
                {topCategories.map(([name, count]) => (
                  <li key={name}>
                    <div className="row row--between" style={{ fontSize: 13 }}>
                      <Link className="link-btn" href={`/knowledge?category=${encodeURIComponent(name)}`}>
                        {name}
                      </Link>
                      <span className="copy">{count}</span>
                    </div>
                    <div className="sla-bar" style={{ marginTop: 6 }}>
                      <div
                        className="sla-bar__fill sla-bar__fill--ok"
                        style={{ width: `${Math.round((count / maxCount) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
                {topCategories.length === 0 && <p className="empty">Belum ada data.</p>}
              </ul>
            </section>
          )}

          {staff && (
            <section className="card">
              <h2 className="card__title">Kualitas penanganan</h2>
              <dl className="dl mt-2">
                <div>
                  <dt>Tingkat reopen</dt>
                  <dd>{reopenRate}%</dd>
                </div>
                <div>
                  <dt>Lewat SLA</dt>
                  <dd>{closed.length - onTime} tiket</dd>
                </div>
                <div>
                  <dt>Terarsip</dt>
                  <dd>{all.length}</dd>
                </div>
              </dl>
            </section>
          )}

          <section className="card">
            <h2 className="card__title">Pertanyaan umum</h2>
            <div className="stack--sm mt-2">
              {FAQ.map((item) => (
                <details className="faq" key={item.q}>
                  <summary>{item.q}</summary>
                  <p className="copy mt-1">{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          <section className="card">
            <h2 className="card__title">Masih butuh bantuan?</h2>
            <p className="copy mt-1">
              {staff
                ? "Untuk urusan internal — role, akses, atau bug — hubungi admin workspace."
                : "Kirim tiket keluhan dan tim kami akan merespons sesuai target SLA."}
            </p>
            <div className="stack--sm mt-2">
              {staff ? (
                <Link className="btn btn--primary btn--block" href="/agent/board">
                  Buka board tiket
                </Link>
              ) : (
                <Link className="btn btn--primary btn--block" href="/dashboard/new">
                  <IconChat /> Ajukan keluhan
                </Link>
              )}
              <a className="btn btn--ghost btn--block" href="mailto:support@qrion.app">
                <IconMail /> support@qrion.app
              </a>
            </div>
          </section>
        </aside>
      </div>

      <section className="card mt-3">
        <h2 className="card__title">Alur status tiket</h2>
        <div className="tbl__wrap mt-2">
          <table className="tbl">
            <thead>
              <tr>
                <th>Status</th>
                <th>Artinya</th>
                <th>Bisa berlanjut ke</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(STATUS_TRANSITIONS).map(([from, to]) => (
                <tr key={from}>
                  <td>
                    <span className="pitem__name">{from}</span>
                  </td>
                  <td className="copy">
                    {from === "Open"
                      ? "Tiket baru, belum ada agen yang mengambil"
                      : from === "In Progress"
                        ? "Agen sedang menangani"
                        : from === "Waiting Validation"
                          ? "Solusi dikirim, menunggu konfirmasi pelanggan"
                          : "Selesai dan divalidasi pelanggan"}
                  </td>
                  <td className="copy">{to.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {staff && (
          <details className="audit mt-3">
            <summary className="audit__summary">
              <span className="card__title">Tabel kebijakan SLA</span>
              <span className="audit__hint">jam</span>
            </summary>
            <div className="tbl__wrap mt-2">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Level</th>
                    <th>Critical</th>
                    <th>High</th>
                    <th>Medium</th>
                    <th>Low</th>
                  </tr>
                </thead>
                <tbody>
                  {(["L1", "L2", "L3"] as const).map((level) => (
                    <tr key={level}>
                      <td>
                        <span className="pitem__name">{level}</span>
                      </td>
                      {(["Critical", "High", "Medium", "Low"] as const).map((u) => (
                        <td key={u} className="copy">
                          {SLA_POLICY[level][u].resolve / 60} jam
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>
    </>
  );
}
