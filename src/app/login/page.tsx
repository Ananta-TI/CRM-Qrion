import Link from "next/link";
import { redirect } from "next/navigation";

import { IconCheck } from "@/components/icons";
import { QrionLogo } from "@/components/qrion-logo";
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
            <QrionLogo />
          </Link>

          <h1 className="auth__title">Masuk ke workspace Anda</h1>
          <p className="auth__sub">
            Kelola keluhan internal, pantau SLA, dan tangani tiket dalam satu
            tempat.
          </p>

          <LoginForm />

          <p className="auth__foot">
            Belum punya akun? <Link href="/register">Daftar sebagai pegawai</Link>
          </p>

          <div className="demo-box">
            <b>Masuk dengan email atau username.</b> Akun programmer dibuat
            lewat halaman <b>Kelola Pengguna</b>; pegawai bisa mendaftar sendiri
            lewat tautan di atas.
          </div>
        </div>
      </div>

      <aside className="auth__aside" aria-hidden="true">
        <p className="auth__quote">
          Setiap keluhan punya jalannya sendiri. Qrion memastikan tidak ada yang
          hilang di tengah.
        </p>
        <p className="auth__by">Internal Complaint Operations</p>
        <ul className="auth__points">
          <li>
            <IconCheck /> Triage otomatis &amp; target SLA per prioritas
          </li>
          <li>
            <IconCheck /> Penugasan langsung ke programmer pilihan
          </li>
          <li>
            <IconCheck /> Validasi pegawai &amp; survei kepuasan
          </li>
          <li>
            <IconCheck /> Riwayat dan status tiket yang selalu terlihat
          </li>
        </ul>
      </aside>
    </div>
  );
}
