"use client";

import { useState, useTransition } from "react";

import { updateTicketStatus } from "@/app/actions/workflow";
import { IconAlert } from "@/components/icons";

/**
 * Customers can bring a Closed ticket back to life. The server action owns the
 * reopen counter, clears the old CSAT and records the audit event; this button
 * only triggers it and refreshes the page.
 */
export function ReopenButton({ ticketId }: { ticketId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reopen() {
    setError(null);
    startTransition(async () => {
      const result = await updateTicketStatus({ ticketId, status: "In Progress" });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      window.location.reload();
    });
  }

  return (
    <div className="stack--sm">
      {error && <p className="form-note form-note--err">{error}</p>}
      <button
        className="btn btn--ghost btn--block"
        type="button"
        disabled={pending}
        onClick={reopen}
      >
        <IconAlert /> {pending ? "Membuka…" : "Buka kembali tiket"}
      </button>
      <p className="copy" style={{ fontSize: 12 }}>
        Gunakan bila masalah muncul lagi. Tiket kembali ke agen tanpa perlu
        membuat tiket baru.
      </p>
    </div>
  );
}
