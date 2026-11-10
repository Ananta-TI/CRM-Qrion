import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthBackdrop } from "@/components/auth-backdrop";
import { IconCheck } from "@/components/icons";
import { MetallicLogo } from "@/components/metallic-logo";
import { QrionLogo } from "@/components/qrion-logo";
import { getSession, homeFor } from "@/lib/auth/session";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Daftar" };

export default async function RegisterPage() {
  const session = await getSession();
  if (session) redirect(homeFor(session.profile.role));

  return (
    <div className="auth">
      <AuthBackdrop />

      <div className="auth__panel">
        <div className="auth__card">
          <Link className="auth__brand" href="/login">
            <QrionLogo />
          </Link>

          <h1 className="auth__title">Buat akun pegawai</h1>
          <p className="auth__sub">
            Ajukan keluhan, pilih programmer tujuan, dan validasi sendiri saat
            masalah selesai.
          </p>

          <RegisterForm />

          <p className="auth__foot">
            Sudah punya akun? <Link href="/login">Masuk di sini</Link>
          </p>
        </div>
      </div>

      <aside className="auth__aside" aria-hidden="true">
        <div className="auth__paint">
          <MetallicLogo />
        </div>

        <p className="auth__quote">
          Anda tidak perlu menebak-nebak lagi. Setiap keluhan terlihat
          statusnya.
        </p>
        <p className="auth__by">Portal Pegawai</p>
        <ul className="auth__points">
          <li>
            <IconCheck /> Ajukan tiket keluhan dalam satu menit
          </li>
          <li>
            <IconCheck /> Pilih programmer atau antrian bersama
          </li>
          <li>
            <IconCheck /> Tombol “Selesai / Belum” untuk validasi
          </li>
        </ul>
      </aside>
    </div>
  );
}
