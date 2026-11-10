"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  claimTicket,
  proposeSolution,
  updateTicketClassification,
  updateTicketStatus,
} from "@/app/actions/workflow";
import { IconAlert, IconCheck, IconSend } from "@/components/icons";
import {
  STATUS_TRANSITIONS,
  TICKET_CATEGORIES,
  URGENCIES,
} from "@/lib/domain/tickets";
import type {
  Ticket,
  TicketCategory,
  TicketStatus,
  UrgencyLevel,
} from "@/lib/types/database";

/**
 * Programmer actions: claim an unassigned ticket, send a solution, and make
 * the small triage corrections that do not need a separate workflow.
 */
export function AgentTicketControls({ ticket }: { ticket: Ticket }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // solution form
  const [solution, setSolution] = useState("");
  const [summary, setSummary] = useState("");

  // manual triage correction
  const [category, setCategory] = useState<TicketCategory>(ticket.category);
  const [priority, setPriority] = useState<UrgencyLevel>(ticket.urgency);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okMsg: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(okMsg);
      // Server actions revalidate the ticket paths; refresh swaps the new
      // server state in without discarding the shell or scroll position.
      router.refresh();
    });
  }

  const nextStatuses = STATUS_TRANSITIONS[ticket.status].filter(
    (s) => s !== "Waiting Validation",
  );

  // "Closed → In Progress" is the reopen path, and "→ Closed" finishes the
  // ticket. Showing the raw enum for those two read like a bug ("why is an
  // In Progress button on a closed ticket?"), so they get plain wording.
  function transitionLabel(to: TicketStatus) {
    if (to === "Closed") return "Tutup tiket";
    if (to === "In Progress" && ticket.status === "Closed") return "Buka kembali";
    return to;
  }

  const closed = ticket.status === "Closed";

  return (
    <section className="card">
      <div className="card__head">
        <h2 className="card__title">Tindakan programmer</h2>
        {!ticket.assignee_id && ticket.status !== "Closed" && (
          <button
            className="btn btn--ghost btn--xs"
            type="button"
            disabled={pending}
            onClick={() => run(() => claimTicket(ticket.id), "Tiket diambil.")}
          >
            Ambil tiket ini
          </button>
        )}
      </div>

      {error && <p className="form-note form-note--err mt-2">{error}</p>}
      {notice && <p className="form-note form-note--ok mt-2">{notice}</p>}

      <div className="quick-status">
        <span className="copy">Status: <strong>{ticket.status}</strong></span>
        <div className="row">
          {nextStatuses.length === 0 && (
            <span className="copy">Tidak ada transisi lanjutan.</span>
          )}
          {nextStatuses.map((s: TicketStatus) => (
            <button
              key={s}
              className="btn btn--ghost btn--sm"
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () => updateTicketStatus({ ticketId: ticket.id, status: s }),
                  `Status diubah ke ${s}.`,
                )
              }
            >
              <IconCheck /> {transitionLabel(s)}
            </button>
          ))}
        </div>
      </div>

      {!closed && (
        <details className="audit mt-2">
          <summary className="audit__summary">
            <span>Koreksi kategori &amp; prioritas</span>
            <span className="audit__hint">Triage manual</span>
          </summary>
          <div className="stack--sm mt-2">
            <p className="copy">
              Heuristik kata kunci bisa salah menebak. Koreksi di sini; target SLA
              dihitung ulang otomatis.
            </p>
            <div className="row" style={{ alignItems: "flex-end", gap: 10 }}>
              <label className="field" style={{ flex: 1 }}>
                <span>Kategori</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as TicketCategory)}
                >
                  {TICKET_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span>Prioritas</span>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as UrgencyLevel)}
                >
                  {URGENCIES.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              disabled={
                pending ||
                (category === ticket.category && priority === ticket.urgency)
              }
              onClick={() =>
                run(
                  () =>
                    updateTicketClassification({
                      ticketId: ticket.id,
                      category,
                      urgency: priority,
                    }),
                  "Klasifikasi tiket diperbarui.",
                )
              }
            >
              <IconCheck /> Simpan koreksi
            </button>
          </div>
        </details>
      )}

      {closed ? (
        <p className="copy mt-2" style={{ color: "var(--amber)" }}>
          <IconAlert style={{ width: 14, height: 14, display: "inline" }} /> Tiket
          ini sudah ditutup, jadi solusi baru tidak bisa dikirim. Buka kembali
          lebih dulu bila masalahnya muncul lagi.
        </p>
      ) : (
        <>
          <div className="stack--sm mt-2">
            <p className="copy">
              Solusi dikirim ke pegawai dan tiket berpindah ke{" "}
              <strong>Waiting Validation</strong>.
            </p>
            <label className="field">
              <span>Penjelasan solusi</span>
              <textarea
                rows={5}
                value={solution}
                maxLength={5000}
                onChange={(e) => setSolution(e.target.value)}
                placeholder="Jelaskan penyebab masalah dan langkah yang sudah Anda lakukan."
              />
            </label>
            <label className="field">
              <span>Ringkasan resolusi (opsional)</span>
              <input
                value={summary}
                maxLength={500}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Contoh: Dana dikembalikan penuh dalam 2 hari kerja."
              />
            </label>
            <button
              className="btn btn--primary"
              type="button"
              disabled={pending || solution.trim().length < 10}
              onClick={() =>
                run(
                  () =>
                    proposeSolution({
                      ticketId: ticket.id,
                      body: solution,
                      resolutionSummary: summary || undefined,
                    }),
                  "Solusi terkirim. Menunggu validasi pegawai.",
                )
              }
            >
              <IconSend /> Kirim solusi &amp; minta validasi
            </button>
          </div>

          {ticket.status === "Waiting Validation" && (
            <p className="copy mt-2" style={{ color: "var(--amber)" }}>
              <IconAlert style={{ width: 14, height: 14, display: "inline" }} />{" "}
              Menunggu validasi pegawai. Kirim solusi baru hanya bila pegawai
              menolak.
            </p>
          )}
        </>
      )}
    </section>
  );
}
