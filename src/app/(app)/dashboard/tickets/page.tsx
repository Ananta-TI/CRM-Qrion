import Link from "next/link";

import { IconPlus, IconSearch } from "@/components/icons";
import { Pager } from "@/components/pager";
import { Empty, PageHead, SlaMeter, StatusPill, UrgencyPill } from "@/components/ui";
import { requireCustomer } from "@/lib/auth/session";
import { relativeTime, sanitizeSearchTerm } from "@/lib/domain/tickets";
import { createClient } from "@/lib/supabase/server";
import type { TicketStatus } from "@/lib/types/database";

export const metadata = { title: "Tiket Saya" };

const PAGE_SIZE = 8;

const FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Open", label: "Open" },
  { key: "In Progress", label: "In Progress" },
  { key: "Waiting Validation", label: "Menunggu Validasi" },
  { key: "Closed", label: "Closed" },
] as const;

export default async function CustomerTicketsPage({
  searchParams,
}: PageProps<"/dashboard/tickets">) {
  const session = await requireCustomer();
  const params = await searchParams;

  const filter = typeof params.status === "string" ? params.status : "all";
  const rawQuery = typeof params.q === "string" ? params.q.trim() : "";
  const q = sanitizeSearchTerm(rawQuery);
  const page = Math.max(1, Number(params.page) || 1);

  const supabase = await createClient();
  let query = supabase
    .from("tickets")
    .select("*", { count: "exact" })
    .eq("customer_id", session.userId)
    .order("created_at", { ascending: false });

  if (filter !== "all") {
    query = query.eq("status", filter as TicketStatus);
  }
  if (q) {
    query = query.or(
      `ticket_code.ilike.%${q}%,subject.ilike.%${q}%,description.ilike.%${q}%`,
    );
  }

  const from = (page - 1) * PAGE_SIZE;
  const { data: tickets, count } = await query.range(from, from + PAGE_SIZE - 1);
  const rows = tickets ?? [];
  const total = count ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filterHref = (key: string) => {
    const search = new URLSearchParams();
    if (key !== "all") search.set("status", key);
    if (rawQuery) search.set("q", rawQuery);
    const qs = search.toString();
    return qs ? `/dashboard/tickets?${qs}` : "/dashboard/tickets";
  };

  return (
    <>
      <PageHead title="Tiket Saya" sub="Riwayat lengkap keluhan dan statusnya.">
        <Link className="btn btn--primary" href="/dashboard/new">
          <IconPlus /> Ajukan Keluhan
        </Link>
      </PageHead>

      <div className="toolbar">
        <div className="tabs">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              className="tab"
              aria-current={filter === f.key ? "true" : undefined}
              href={filterHref(f.key)}
              prefetch={false}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <p className="toolbar__meta">
          <b>{total}</b> tiket
        </p>
      </div>

      <form className="search toolbar__search" role="search" action="/dashboard/tickets">
        <label className="sr-only" htmlFor="ticket-search">
          Cari tiket
        </label>
        <IconSearch className="search__icon" />
        <input
          id="ticket-search"
          name="q"
          type="search"
          defaultValue={rawQuery}
          placeholder="Cari kode tiket atau subjek…"
          autoComplete="off"
        />
        {filter !== "all" && <input type="hidden" name="status" value={filter} />}
      </form>

      {rows.length === 0 ? (
        <section className="card mt-3">
          <Empty>
            {q || filter !== "all"
              ? "Tidak ada tiket yang cocok. Coba kata kunci atau filter lain."
              : "Belum ada tiket."}{" "}
            <Link className="link-btn" href="/dashboard/new">
              Ajukan keluhan baru
            </Link>
          </Empty>
        </section>
      ) : (
        <div className="stack mt-3">
          {rows.map((ticket) => (
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
                    href={`/dashboard/tickets/${ticket.id}`}
                    prefetch={false}
                    style={{ display: "block", marginTop: 8 }}
                  >
                    {ticket.subject}
                  </Link>
                  <div className="detail__meta">
                    <span>{ticket.category}</span>
                    <span>Dibuat {relativeTime(ticket.created_at)}</span>
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
                  />
                </div>
              </div>

              {ticket.status === "Waiting Validation" && (
                <div className="validate mt-2">
                  <p className="validate__title">Solusi sudah dikirim</p>
                  <p className="validate__sub">
                    Mohon konfirmasi apakah masalah Anda sudah teratasi.
                  </p>
                  <div className="validate__row">
                    <Link
                      className="btn btn--primary btn--sm"
                      href={`/dashboard/tickets/${ticket.id}`}
                      prefetch={false}
                    >
                      Validasi sekarang
                    </Link>
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <Pager
        page={page}
        pageCount={pageCount}
        basePath="/dashboard/tickets"
        params={{
          status: filter !== "all" ? filter : undefined,
          q: rawQuery || undefined,
        }}
      />
    </>
  );
}
