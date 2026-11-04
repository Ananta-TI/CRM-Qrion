"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="auth" style={{ gridTemplateColumns: "1fr" }}>
      <div className="auth__panel">
        <div className="auth__card" style={{ textAlign: "center" }}>
          <h1 className="auth__title">Terjadi kesalahan</h1>
          <p className="auth__sub">
            Sesuatu gagal dimuat. Coba lagi — bila masih berlanjut, hubungi
            admin workspace.
          </p>
          <p className="copy" style={{ fontFamily: "monospace", fontSize: 12 }}>
            {error.message}
          </p>
          <div className="row mt-2" style={{ justifyContent: "center" }}>
            <button className="btn btn--primary" type="button" onClick={reset}>
              Coba lagi
            </button>
            <Link className="btn btn--ghost" href="/">
              Ke dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
