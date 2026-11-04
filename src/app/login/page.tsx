import Link from "next/link";
import { redirect } from "next/navigation";

import { IconCheck, IconLogo } from "@/components/icons";
import { getSession, homeFor } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Masuk" };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(homeFor(session.profile.role));

  return (
    <div className="auth">
      <div className="auth__panel">
        <div className="auth__card">
          <Link className="auth__brand" href="/login">
            <IconLogo className="brand__mark" />
            <span className="brand__name">Qrion</span>
          </Link>

          <h1 className="auth__title">Masuk ke workspace Anda</h1>
          <p className="auth__sub">
            Kelola keluhan pelanggan, pantau SLA, dan eskalasi tiket dalam satu
            tempat.
          </p>

          <LoginForm />

          <p className="auth__foot">
            Belum punya akun? <Link href="/register">Daftar sebagai pelanggan</Link>
          </p>

          <div className="demo-box">
            <b>Akun admin</b> dibuat lewat SQL atau halaman{" "}
            <b>Kelola Pengguna</b>. Pengguna biasa mendaftar sendiri lewat tautan
            di atas.
          </div>
        </div>
      </div>

      <aside className="auth__aside" aria-hidden="true">
        <p className="auth__quote">
          Setiap keluhan punya jalannya sendiri. Qrion memastikan tidak ada yang
          hilang di tengah.
        </p>
        <p className="auth__by">Customer Complaint Operations</p>
        <ul className="auth__points">
          <li>
            <IconCheck /> Triage otomatis &amp; target SLA per prioritas
          </li>
          <li>
            <IconCheck /> Eskalasi berjenjang L1 → L2 → L3
          </li>
          <li>
            <IconCheck /> Validasi pelanggan &amp; survei kepuasan
          </li>
          <li>
            <IconCheck /> Arsip resolusi yang bisa dicari
          </li>
        </ul>
      </aside>
    </div>
  );
}
