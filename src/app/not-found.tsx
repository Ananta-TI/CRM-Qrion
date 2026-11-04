import Link from "next/link";

export default function NotFound() {
  return (
    <div className="auth" style={{ gridTemplateColumns: "1fr" }}>
      <div className="auth__panel">
        <div className="auth__card" style={{ textAlign: "center" }}>
          <p className="stat__num" style={{ fontSize: 64 }}>
            404
          </p>
          <h1 className="auth__title mt-2">Halaman tidak ditemukan</h1>
          <p className="auth__sub">
            Tautan mungkin sudah kedaluwarsa, atau tiket ini bukan milik Anda.
          </p>
          <div className="row" style={{ justifyContent: "center" }}>
            <Link className="btn btn--primary" href="/">
              Kembali ke dashboard
            </Link>
            <Link className="btn btn--ghost" href="/help">
              Pusat bantuan
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
