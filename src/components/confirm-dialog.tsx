"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * A small confirmation dialog built on native <dialog>, so focus trapping,
 * Escape and the backdrop come for free. Used for account-management actions
 * that should not fire on a single stray click.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Ya, lanjutkan",
  cancelLabel = "Batal",
  tone = "primary",
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      className="dlg"
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => {
        if (open) onCancel();
      }}
    >
      <div className="dlg__form">
        <p className="dlg__title" id={titleId}>
          {title}
        </p>
        {body && <p className="dlg__sub">{body}</p>}

        {error && <p className="form-note form-note--err">{error}</p>}

        <div className="dlg__row">
          <button
            className="btn btn--ghost"
            type="button"
            disabled={pending}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className={`btn ${tone === "danger" ? "btn--danger" : "btn--primary"}`}
            type="button"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Memproses…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}