"use client";

import { useActionState } from "react";

import { signUp, type AuthState } from "@/app/actions/auth";
import { USERNAME_HINT, USERNAME_PATTERN } from "@/lib/auth/username";

export function RegisterForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(signUp, {});

  return (
    <form action={action} className="stack" noValidate>
      {state.error && <p className="form-note form-note--err">{state.error}</p>}
      {state.notice && <p className="form-note form-note--ok">{state.notice}</p>}

      <label className="field">
        <span>Nama lengkap</span>
        <input
          name="fullName"
          required
          minLength={2}
          maxLength={80}
          autoComplete="name"
          placeholder="Budi Santoso"
        />
      </label>

      <label className="field">
        <span>Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="nama@perusahaan.com"
        />
      </label>

      <label className="field">
        <span>
          Username <em style={{ opacity: 0.6 }}>(opsional)</em>
        </span>
        <input
          name="username"
          pattern={USERNAME_PATTERN}
          maxLength={32}
          autoComplete="username"
          placeholder="budi.santoso"
        />
        <span className="copy" style={{ fontSize: 12 }}>
          {USERNAME_HINT} Bisa diatur nanti di Pengaturan.
        </span>
      </label>

      <div className="form-grid">
        <label className="field">
          <span>Perusahaan <em style={{ opacity: 0.6 }}>(opsional)</em></span>
          <input name="company" maxLength={80} placeholder="PT Contoh Jaya" />
        </label>
        <label className="field">
          <span>Telepon <em style={{ opacity: 0.6 }}>(opsional)</em></span>
          <input name="phone" maxLength={24} placeholder="0812…" />
        </label>
      </div>

      <label className="field">
        <span>Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          placeholder="Minimal 6 karakter"
        />
      </label>

      <button className="btn btn--primary btn--block" type="submit" disabled={pending}>
        {pending ? "Membuat akun…" : "Daftar"}
      </button>
    </form>
  );
}
