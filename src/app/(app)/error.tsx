"use client";

import Link from "next/link";
import { useEffect } from "react";

import { IconAlert } from "@/components/icons";

/**
 * Keep failures inside the app frame. Without this boundary an error in a page
 * bubbles to the root error screen, which replaces the sidebar and header.
 */
export default function AppError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="card" role="alert">
      <div className="row row--center">
        <IconAlert style={{ width: 18, height: 18, color: "var(--bad)" }} />
        <h2 className="card__title">Halaman gagal dimuat</h2>
      </div>

      <p className="copy mt-2">
        Terjadi gangguan saat mengambil data. Coba muat ulang halaman ini; bila
        masih gagal, kembali ke beranda dan buka kembali menu yang Anda tuju.
      </p>

      <div className="row mt-2">
        <button className="btn btn--primary" type="button" onClick={() => retry()}>
          Coba lagi
        </button>
        <Link className="btn btn--ghost" href="/dashboard">
          Kembali ke beranda
        </Link>
      </div>
    </section>
  );
}
