import Link from "next/link";

import { IconSearch } from "@/components/icons";
import { Pager } from "@/components/pager";
import { PageHead } from "@/components/ui";
import { requireStaff, viewerId } from "@/lib/auth/session";
import { sanitizeSearchTerm } from "@/lib/domain/tickets";
import { createClient } from "@/lib/supabase/server";
import type { Ticket, TicketStatus } from "@/lib/types/database";
import { TicketBoard, type BoardTicket } from "./ticket-board";

export const metadata = { title: "Board Tiket" };

const PAGE_SIZE = 8;

const FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Open", label: "Open" },
  { key: "In Progress", label: "In Progress" },
  { key: "Waiting Validation", label: "Menunggu Validasi" },
  { key: "Closed", label: "Closed" },
] as const;

export default async function AgentBoardPage({
  searchParams,
}: PageProps<"/agent/board">) {
  // Back-office only: the layout checks for a session, this checks the role.
  // `viewerId()` comes from the proxy's verified JWT claim, so the ticket read
  // starts at the same moment as the profile lookup instead of after it.
  const params = await searchParams;
  const viewerPromise = viewerId();

  const filter = typeof params.status === "string" ? params.status : "all";
  const rawQuery = typeof params.q === "string" ? params.q.trim() : "";
  const q = sanitizeSearchTerm(rawQuery);
  const page = Math.max(1, Number(params.page) || 1);

  const supabase = await createClient();

  const queryPromise = (async () => {
    const viewer = await viewerPromise;
    if (!viewer) return { data: [] as Ticket[], count: 0 };

    let query = supabase
      .from("tickets")
      .select("*", { count: "exact" })
      .or(`assignee_id.is.null,assignee_id.eq.${viewer}`)
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
    return query.range(from, from + PAGE_SIZE - 1);
  })();

  const [, { data: raw, count }] = await Promise.all([
    requireStaff(),
    queryPromise,
  ]);
  const tickets = raw ?? [];
  const total = count ?? tickets.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // One extra pass to attach the customer name and message counts, instead of
  // an N+1 of per-ticket queries. Only the current page needs names.
  const customerIds = Array.from(new Set(tickets.map((t) => t.customer_id)));
  const ticketIds = tickets.map((t) => t.id);

  const [{ data: customers }, { data: messageRows }] = await Promise.all([
    customerIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", customerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    ticketIds.length
      ? supabase.from("messages").select("ticket_id, kind").in("ticket_id", ticketIds)
      : Promise.resolve({ data: [] as { ticket_id: string; kind: string }[] }),
  ]);

  const nameById = new Map((customers ?? []).map((c) => [c.id, c.full_name]));
  const countByTicket = new Map<string, number>();
  for (const row of messageRows ?? []) {
    if (row.kind === "note") continue;
    countByTicket.set(row.ticket_id, (countByTicket.get(row.ticket_id) ?? 0) + 1);
  }

  const boardTickets: BoardTicket[] = tickets.map((t) => ({
    ...t,
    customer_name: nameById.get(t.customer_id) ?? "Pegawai",
    message_count: countByTicket.get(t.id) ?? 0,
  }));

  const filterHref = (key: string) => {
    const search = new URLSearchParams();
    if (key !== "all") search.set("status", key);
    if (rawQuery) search.set("q", rawQuery);
    const qs = search.toString();
    return qs ? `/agent/board?${qs}` : "/agent/board";
  };

  return (
    <>
      <PageHead
        title="Board Tiket"
        sub="Tiket yang ditujukan kepada Anda dan antrian bersama yang belum diambil."
      />

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

      <form className="search toolbar__search" role="search" action="/agent/board">
        <label className="sr-only" htmlFor="board-search">
          Cari tiket
        </label>
        <IconSearch className="search__icon" />
        <input
          id="board-search"
          name="q"
          type="search"
          defaultValue={rawQuery}
          placeholder="Cari kode tiket, subjek, atau keluhan…"
          autoComplete="off"
        />
        {filter !== "all" && <input type="hidden" name="status" value={filter} />}
      </form>

      <TicketBoard tickets={boardTickets} />

      <Pager
        page={page}
        pageCount={pageCount}
        basePath="/agent/board"
        params={{
          status: filter !== "all" ? filter : undefined,
          q: rawQuery || undefined,
        }}
      />
    </>
  );
}
