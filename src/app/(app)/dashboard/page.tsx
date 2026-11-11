import Link from "next/link";

import {
  Avatar,
  PageHead,
  StatCard,
  StatusPill,
  UrgencyPill,
} from "@/components/ui";
import { IconPlus, IconTicket } from "@/components/icons";
import { requireCustomer, viewerId } from "@/lib/auth/session";
import { greetingName } from "@/lib/domain/people";
import { relativeTime } from "@/lib/domain/tickets";
import { createClient } from "@/lib/supabase/server";
import type { Ticket } from "@/lib/types/database";

export const metadata = { title: "Dashboard" };

export default async function CustomerDashboard() {
  const supabase = await createClient();
  const viewerPromise = viewerId();

  const ticketsPromise = (async () => {
    const viewer = await viewerPromise;
    if (!viewer) return { data: [] as Ticket[] };

    return supabase
      .from("tickets")
      .select("*")
      .eq("customer_id", viewer)
      .order("created_at", { ascending: false });
  })();

  const [session, { data: tickets }] = await Promise.all([
    requireCustomer(),
    ticketsPromise,
  ]);

  const rows = tickets ?? [];

  const open = rows.filter((t) => t.status === "Open").length;
  const active = rows.filter((t) => t.status === "In Progress").length;
  const waiting = rows.filter((t) => t.status === "Waiting Validation").length;
  const closed = rows.filter((t) => t.status === "Closed").length;

  // The most urgent thing the customer needs to act on.
  const needsValidation = rows.filter((t) => t.status === "Waiting Validation");
  const recent = rows.slice(0, 5);

  return (
    <>
      <PageHead
        title={`Halo, ${greetingName(session.profile.full_name)}`}
        sub="Semua keluhan Anda, beserta target penyelesaiannya."
      >
        <Link className="btn btn--primary" href="/dashboard/new">
          <IconPlus /> Ajukan Keluhan
        </Link>
      </PageHead>

      {needsValidation.length > 0 && (
        <div className="banner banner--warn" style={{ marginBottom: "var(--gap)" }}>
          <span className="promo__icon" style={{ background: "var(--amber)", color: "#fff" }}>
            <IconTicket />
          </span>
          <div className="banner__text">
            <p className="banner__title">
              {needsValidation.length} tiket menunggu validasi Anda
            </p>
            <p className="banner__sub">
              Programmer sudah mengirim solusi. Konfirmasi apakah masalah Anda sudah
              selesai.
            </p>
          </div>
          <Link
            className="btn btn--warn btn--sm"
            href={`/dashboard/tickets/${needsValidation[0].id}`}
            prefetch={false}
          >
            Tinjau sekarang
          </Link>
        </div>
      )}

      <div className="grid">
        <StatCard title="Menunggu Validasi" value={waiting} note="Perlu konfirmasi Anda" href="/dashboard/tickets" />
        <StatCard title="Sedang Diproses" value={active} note="Ditangani programmer" href="/dashboard/tickets" />
        <StatCard title="Tiket Baru" value={open} note="Belum diambil programmer" href="/dashboard/tickets" />
        <StatCard title="Selesai" value={closed} note="Tiket tertutup" href="/dashboard/tickets" />
      </div>

      <div className="split mt-3">
        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Tiket terbaru</h2>
            <Link className="link-btn" href="/dashboard/tickets">
              Lihat semua
            </Link>
          </div>

          {recent.length === 0 ? (
            <p className="empty">
              Belum ada tiket. Ajukan keluhan pertama Anda dan tim kami akan
              merespons sesuai SLA.
            </p>
          ) : (
            <ul className="plist">
              {recent.map((ticket) => (
                <li key={ticket.id} className="pitem">
                  <span
                    className={`pico ${
                      ticket.urgency === "Critical" || ticket.urgency === "High"
                        ? "pico--api"
                        : ticket.urgency === "Medium"
                          ? "pico--speed"
                          : "pico--flow"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="pitem__body">
                    <Link className="pitem__name" href={`/dashboard/tickets/${ticket.id}`} prefetch={false}>
                      {ticket.subject}
                    </Link>
                    <span className="pitem__due">
                      <span className="code-ref">{ticket.ticket_code}</span> ·{" "}
                      {ticket.category} · {relativeTime(ticket.created_at)}
                    </span>
                  </span>
                  <span className="stack--sm" style={{ alignItems: "flex-end" }}>
                    <StatusPill status={ticket.status} />
                    <UrgencyPill urgency={ticket.urgency} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="side">
          <section className="card">
            <h2 className="card__title">Target SLA Anda</h2>
            <p className="copy mt-1">
              Setiap prioritas punya batas waktu penyelesaian. Kami berkomitmen
              menyelesaikan sebelum batas ini.
            </p>
            <ul className="dl mt-2">
              <div>
                <dt>Critical</dt>
                <dd>4 jam</dd>
              </div>
              <div>
                <dt>High</dt>
                <dd>8 jam</dd>
              </div>
              <div>
                <dt>Medium</dt>
                <dd>24 jam</dd>
              </div>
              <div>
                <dt>Low</dt>
                <dd>72 jam</dd>
              </div>
            </ul>
          </section>

          <section className="card">
            <h2 className="card__title">Profil</h2>
            <div className="row row--center mt-2">
              <Avatar
                name={session.profile.full_name}
                tint={session.profile.avatar_tint}
                size="lg"
              />
              <div>
                <p className="pitem__name">{session.profile.full_name}</p>
                <p className="pitem__due">{session.profile.email}</p>
              </div>
            </div>
            {session.profile.company && (
              <p className="copy mt-2">{session.profile.company}</p>
            )}
            <Link className="btn btn--ghost btn--block mt-2" href="/settings">
              Edit profil
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}
