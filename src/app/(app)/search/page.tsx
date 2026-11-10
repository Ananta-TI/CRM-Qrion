import Link from "next/link";

import { Empty, PageHead, StatusPill, UrgencyPill } from "@/components/ui";
import { isStaff, requireSession } from "@/lib/auth/session";
import { relativeTime, sanitizeSearchTerm } from "@/lib/domain/tickets";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Pencarian" };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const session = await requireSession();
  const staff = isStaff(session.profile.role);
  const params = await searchParams;
  const rawQuery = typeof params.q === "string" ? params.q.trim() : "";
  const q = sanitizeSearchTerm(rawQuery);

  const supabase = await createClient();
  let tickets: {
    id: string;
    ticket_code: string;
    subject: string;
    status: "Open" | "In Progress" | "Waiting Validation" | "Closed";
    urgency: "Low" | "Medium" | "High" | "Critical";
    category: string;
    created_at: string;
  }[] = [];

  if (q) {
    let query = supabase
      .from("tickets")
      .select("id, ticket_code, subject, status, urgency, category, created_at")
      .or(`subject.ilike.%${q}%,description.ilike.%${q}%,ticket_code.ilike.%${q}%`);

    // RLS already scopes rows; repeat the scope here so a future policy
    // mistake cannot turn the search into a cross-user index.
    query = staff
      ? query.or(`assignee_id.is.null,assignee_id.eq.${session.userId}`)
      : query.eq("customer_id", session.userId);

    const { data } = await query
      .order("created_at", { ascending: false })
      .limit(50);
    tickets = data ?? [];
  }
  const base = staff ? "/agent/tickets" : "/dashboard/tickets";

  return (
    <>
      <PageHead
        title="Hasil pencarian"
        sub={rawQuery ? `Pencarian untuk “${rawQuery}”` : "Ketik sesuatu di kotak pencarian."}
      />

      <section className="card">
        {!rawQuery ? (
          <Empty>Masukkan kata kunci untuk mencari tiket.</Empty>
        ) : tickets.length === 0 ? (
          <Empty>
            Tidak ada tiket yang cocok dengan “{rawQuery}”. Coba kata kunci lain, atau
            telusuri kata kunci lain.
          </Empty>
        ) : (
          <>
            <div className="card__head">
              <h2 className="card__title">{tickets.length} tiket ditemukan</h2>
            </div>
            <ul className="plist">
              {tickets.map((t) => (
                <li className="pitem" key={t.id}>
                  <span className="pitem__body">
                    <Link className="pitem__name" href={`${base}/${t.id}`} prefetch={false}>
                      {t.subject}
                    </Link>
                    <span className="pitem__due">
                      <span className="code-ref">{t.ticket_code}</span> · {t.category}{" "}
                      · {relativeTime(t.created_at)}
                    </span>
                  </span>
                  <span className="stack--sm" style={{ alignItems: "flex-end" }}>
                    <StatusPill status={t.status} />
                    <UrgencyPill urgency={t.urgency} />
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
