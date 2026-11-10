"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateTicketStatus } from "@/app/actions/workflow";
import { IconAlert } from "@/components/icons";
import { REOPEN_WINDOW_DAYS } from "@/lib/domain/tickets";

/**
 * Customers can bring a Closed ticket back to life for a limited time. The
 * server action owns the window check, the reopen counter, the old CSAT reset
 * and the audit event; this button only triggers it and refreshes the page.
 */
export function ReopenButton({
  ticketId,
  reopenable,
}: {
  ticketId: string;
  reopenable: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!reopenable) {
    return (
      <div className="stack--sm">
        <p className="copy" style={{ fontSize: 12 }}>
          Masa buka kembali ({REOPEN_WINDOW_DAYS} hari setelah tiket ditutup)
          sudah lewat. Silakan buat tiket baru agar riwayat dan SLA tiket lama
          tetap akurat.
        </p>
        <Link className="btn btn--ghost btn--block" href="/dashboard/new">
          Buat tiket baru
        </Link>
      </div>
    );
  }

  function reopen() {
    setError(null);
    startTransition(async () => {
      const result = await updateTicketStatus({ ticketId, status: "In Progress" });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Refresh in place so the shell and scroll position survive.
      router.refresh();
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
        Gunakan bila masalah muncul lagi dalam {REOPEN_WINDOW_DAYS} hari setelah
        tiket ditutup. Setelah itu, buat tiket baru.
      </p>
    </div>
  );
}
