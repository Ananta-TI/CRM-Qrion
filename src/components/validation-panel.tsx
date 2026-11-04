"use client";

import { useState, useTransition } from "react";

import { validateResolution } from "@/app/actions/workflow";
import { IconCheck, IconAlert } from "@/components/icons";

/**
 * The customer's verdict on a proposed solution.
 *
 * "Masalah Selesai" closes the ticket (and triggers the CSAT survey).
 * "Belum Selesai" reopens it and sends it straight back to the agent.
 */
export function ValidationPanel({ ticketId }: { ticketId: string }) {
  const [mode, setMode] = useState<"idle" | "reject">("idle");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function resolve(satisfied: boolean, note?: string) {
    setError(null);
    startTransition(async () => {
      const result = await validateResolution({
        ticketId,
        satisfied,
        reason: note,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (satisfied) {
        // Reload so the closed state and CSAT modal take over.
        window.location.reload();
      } else {
        setMode("idle");
        setReason("");
      }
    });
  }

  return (
    <section className="validate" aria-labelledby="validate-title">
      <p className="validate__title" id="validate-title">
        Apakah masalah Anda sudah selesai?
      </p>
      <p className="validate__sub">
        Agen sudah mengirim solusi. Konfirmasi agar kami dapat menutup tiket, atau
        kembalikan bila belum tuntas.
      </p>

      {error && (
        <p className="form-note form-note--err mt-2">{error}</p>
      )}

      {mode === "idle" ? (
        <div className="validate__row">
          <button
            className="btn btn--primary"
            type="button"
            disabled={pending}
            onClick={() => resolve(true)}
          >
            <IconCheck /> Masalah Selesai
          </button>
          <button
            className="btn btn--danger"
            type="button"
            disabled={pending}
            onClick={() => setMode("reject")}
          >
            <IconAlert /> Belum Selesai
          </button>
        </div>
      ) : (
        <div className="stack--sm mt-2">
          <label className="field">
            <span>Apa yang masih belum beres?</span>
            <textarea
              rows={3}
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: dana masih belum masuk ke rekening saya."
            />
          </label>
          <div className="row">
            <button
              className="btn btn--danger btn--sm"
              type="button"
              disabled={pending}
              onClick={() => resolve(false, reason)}
            >
              {pending ? "Mengirim…" : "Kirim & buka kembali tiket"}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              disabled={pending}
              onClick={() => setMode("idle")}
            >
              Batal
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
