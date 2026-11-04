"use client";

import { useState, useTransition } from "react";

import {
  claimTicket,
  escalateTicket,
  proposeSolution,
  updateTicketStatus,
} from "@/app/actions/workflow";
import { IconAlert, IconCheck, IconSend, IconUp } from "@/components/icons";
import { ESCALATION_LEVELS, STATUS_TRANSITIONS } from "@/lib/domain/tickets";
import type { Ticket, TicketStatus, UrgencyLevel } from "@/lib/types/database";

const REASONS = [
  "Butuh penanganan teknis lanjutan",
  "Perlu persetujuan kebijakan",
  "Keluhan berulang / pelanggan eskalasi",
  "Di luar kewenangan L1",
  "Dampak finansial signifikan",
];

/**
 * Agent actions, trimmed to the two things that actually move a ticket:
 * sending a solution and escalating it. Status changes are inline buttons
 * instead of a separate tab, and a solution auto-archives its summary to the
 * Knowledge Base (the server action records the event).
 */
export function AgentTicketControls({
  ticket,
  isAssignee,
}: {
  ticket: Ticket;
  isAssignee: boolean;
}) {
  const [tab, setTab] = useState<"solution" | "escalate">("solution");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // solution form
  const [solution, setSolution] = useState("");
  const [summary, setSummary] = useState("");

  // escalation form
  const [level, setLevel] = useState(
    ticket.escalation_level === "L1" ? "L2" : "L3",
  );
  const [reason, setReason] = useState(REASONS[0]);
  const [urgentBump, setUrgentBump] = useState<UrgencyLevel | "keep">("keep");

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
      window.location.reload();
    });
  }

  const nextStatuses = STATUS_TRANSITIONS[ticket.status].filter(
    (s) => s !== "Waiting Validation",
  );

  return (
    <section className="card">
      <div className="card__head">
        <h2 className="card__title">Tindakan agen</h2>
        {!isAssignee && ticket.status !== "Closed" && (
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
              <IconCheck /> {s}
            </button>
          ))}
        </div>
      </div>

      <div className="tabs mt-2">
        <button className="tab" aria-current={tab === "solution"} type="button" onClick={() => setTab("solution")}>
          Kirim solusi
        </button>
        <button className="tab" aria-current={tab === "escalate"} type="button" onClick={() => setTab("escalate")}>
          Eskalasi
        </button>
      </div>

      {tab === "solution" && (
        <div className="stack--sm mt-2">
          <p className="copy">
            Solusi dikirim ke pelanggan dan tiket berpindah ke{" "}
            <strong>Waiting Validation</strong>. Ringkasannya otomatis masuk ke
            Knowledge Base — tidak perlu mengarsipkan dua kali.
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
            <span>Ringkasan resolusi (untuk arsip)</span>
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
                "Solusi terkirim dan diarsipkan. Menunggu validasi pelanggan.",
              )
            }
          >
            <IconSend /> Kirim solusi &amp; minta validasi
          </button>
        </div>
      )}

      {tab === "escalate" && (
        <div className="stack--sm mt-2">
          <p className="copy">
            Pelanggan saat ini di{" "}
            <strong>Level {ticket.escalation_level}</strong>. Menanjak ke level
            lebih tinggi memperpendek target SLA.
          </p>

          <label className="field">
            <span>Lanjutkan ke</span>
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              {ESCALATION_LEVELS.filter(
                (l) => ESCALATION_LEVELS.indexOf(l) > ESCALATION_LEVELS.indexOf(ticket.escalation_level),
              ).map((l) => (
                <option key={l} value={l}>
                  {l === "L2" ? "L2 · Tim Teknis" : "L3 · Manajemen"}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Alasan eskalasi</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Sesuaikan prioritas (opsional)</span>
            <select
              value={urgentBump}
              onChange={(e) => setUrgentBump(e.target.value as UrgencyLevel | "keep")}
            >
              <option value="keep">Biarkan {ticket.urgency}</option>
              <option value="High">Naikkan ke High</option>
              <option value="Critical">Naikkan ke Critical</option>
            </select>
          </label>

          <button
            className="btn btn--warn"
            type="button"
            disabled={pending || level === ticket.escalation_level}
            onClick={() =>
              run(
                () =>
                  escalateTicket({
                    ticketId: ticket.id,
                    targetLevel: level,
                    reason,
                    urgency: urgentBump === "keep" ? undefined : urgentBump,
                  }),
                `Tiket dieskalasi ke ${level}.`,
              )
            }
          >
            <IconUp /> Eskalasi ke {level}
          </button>
        </div>
      )}

      {ticket.status === "Waiting Validation" && (
        <p className="copy mt-2" style={{ color: "var(--amber)" }}>
          <IconAlert style={{ width: 14, height: 14, display: "inline" }} /> Menunggu
          validasi pelanggan. Kirim solusi baru hanya bila pelanggan menolak.
        </p>
      )}
    </section>
  );
}
