import Link from "next/link";
import { redirect } from "next/navigation";

import { IconCheck, IconLogo } from "@/components/icons";
import { getSession, homeFor } from "@/lib/auth/session";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Daftar" };

export default async function RegisterPage() {
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

          <h1 className="auth__title">Buat akun pelanggan</h1>
          <p className="auth__sub">
            Ajukan keluhan, pantau perkembangannya, dan validasi sendiri saat
            masalah selesai.
          </p>

          <RegisterForm />

          <p className="auth__foot">
            Sudah punya akun? <Link href="/login">Masuk di sini</Link>
          </p>
        </div>
      </div>

      <aside className="auth__aside" aria-hidden="true">
        <p className="auth__quote">
          Anda tidak perlu menebak-nebak lagi. Setiap keluhan terlihat
          statusnya.
        </p>
        <p className="auth__by">Portal Pelanggan</p>
        <ul className="auth__points">
          <li>
            <IconCheck /> Ajukan tiket keluhan dalam satu menit
          </li>
          <li>
            <IconCheck /> Lihat target SLA dan siapa yang menangani
          </li>
          <li>
            <IconCheck /> Tombol “Selesai / Belum” untuk validasi
          </li>
        </ul>
      </aside>
    </div>
  );
}
