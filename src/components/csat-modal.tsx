"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { submitCsat } from "@/app/actions/workflow";
import { IconClose, IconStar } from "@/components/icons";

const LABELS = ["", "Sangat buruk", "Buruk", "Cukup", "Baik", "Sangat baik"];

/**
 * Post-closure CSAT survey.
 *
 * Never opens by itself: the customer taps "Isi survei kepuasan" on a closed
 * ticket. Uses a native <dialog> so focus trapping and Esc come for free.
 */
export function CsatModal({
  ticketId,
  ticketCode,
  alreadyScored,
}: {
  ticketId: string;
  ticketCode: string;
  alreadyScored: number | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  function send() {
    setError(null);
    if (score < 1) {
      setError("Pilih bintang terlebih dahulu.");
      return;
    }

    startTransition(async () => {
      const result = await submitCsat({ ticketId, score, comment: comment || undefined });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
      setTimeout(() => setOpen(false), 1200);
    });
  }

  return (
    <>
      {!open && alreadyScored === null && (
        <button
          className="btn btn--ghost btn--sm"
          type="button"
          onClick={() => setOpen(true)}
        >
          <IconStar /> Isi survei kepuasan
        </button>
      )}

      <dialog
        className="dlg"
        ref={ref}
        aria-labelledby="csat-title"
        onClose={() => setOpen(false)}
      >
        <div className="dlg__form">
          {done ? (
            <div style={{ textAlign: "center", padding: "18px 0" }}>
              <p className="dlg__title" id="csat-title">
                Terima kasih!
              </p>
              <p className="dlg__sub mt-1">
                Masukan Anda membantu kami memperbaiki layanan.
              </p>
            </div>
          ) : (
            <>
              <div className="row row--between">
                <div>
                  <p className="dlg__title" id="csat-title">
                    Seberapa puas Anda?
                  </p>
                  <p className="dlg__sub mt-1">
                    Tiket <span className="code-ref">{ticketCode}</span> telah
                    ditutup.
                  </p>
                </div>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Tutup survei"
                  onClick={() => setOpen(false)}
                >
                  <IconClose />
                </button>
              </div>

              {error && <p className="form-note form-note--err">{error}</p>}

              <div className="stars" onMouseLeave={() => setHover(0)}>
                {[1, 2, 3, 4, 5].map((i) => {
                  const on = i <= (hover || score);
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`star ${on ? "star--on" : ""}`}
                      aria-label={`${i} bintang — ${LABELS[i]}`}
                      onMouseEnter={() => setHover(i)}
                      onClick={() => setScore(i)}
                    >
                      <IconStar />
                    </button>
                  );
                })}
              </div>

              <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                {LABELS[hover || score] || "Pilih 1 sampai 5 bintang"}
              </p>

              <label className="field">
                <span>Komentar (opsional)</span>
                <textarea
                  rows={3}
                  value={comment}
                  maxLength={1000}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Apa yang bisa kami perbaiki?"
                />
              </label>

              <div className="dlg__row">
                <button
                  className="btn btn--ghost"
                  type="button"
                  onClick={() => setOpen(false)}
                >
                  Nanti saja
                </button>
                <button
                  className="btn btn--primary"
                  type="button"
                  disabled={pending || score < 1}
                  onClick={send}
                >
                  {pending ? "Mengirim…" : "Kirim survei"}
                </button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
