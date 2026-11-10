"use client";

import { useActionState } from "react";

import {
  updateEmail,
  updatePassword,
  updateUsername,
  type AuthState,
} from "@/app/actions/auth";
import { USERNAME_HINT, USERNAME_PATTERN } from "@/lib/auth/username";

function FormNote({ state }: { state: AuthState }) {
  if (state.error) {
    return <p className="form-note form-note--err">{state.error}</p>;
  }
  if (state.notice) {
    return <p className="form-note form-note--ok">{state.notice}</p>;
  }
  return null;
}

function UsernameForm({ username }: { username: string | null }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    updateUsername,
    {},
  );

  return (
    <form action={action} className="stack--sm mt-2" noValidate>
      <FormNote state={state} />

      <label className="field">
        <span>Username</span>
        <input
          name="username"
          defaultValue={username ?? ""}
          pattern={USERNAME_PATTERN}
          minLength={3}
          maxLength={32}
          autoComplete="username"
          required
          placeholder="bang.ridho"
        />
        <span className="copy" style={{ fontSize: 12 }}>
          {USERNAME_HINT}
        </span>
      </label>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn--ghost btn--sm" type="submit" disabled={pending}>
          {pending ? "Menyimpan…" : "Simpan username"}
        </button>
      </div>
    </form>
  );
}

function EmailForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    updateEmail,
    {},
  );

  return (
    <form action={action} className="stack--sm mt-2" noValidate>
      <FormNote state={state} />

      <label className="field">
        <span>Email login</span>
        <input
          name="email"
          type="email"
          defaultValue={email}
          autoComplete="email"
          required
          placeholder="nama@perusahaan.com"
        />
      </label>

      <label className="field">
        <span>Password saat ini</span>
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          minLength={6}
          required
          placeholder="Untuk memastikan ini Anda"
        />
      </label>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn--ghost btn--sm" type="submit" disabled={pending}>
          {pending ? "Menyimpan…" : "Ganti email"}
        </button>
      </div>
    </form>
  );
}

function PasswordForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    updatePassword,
    {},
  );

  return (
    <form action={action} className="stack--sm mt-2" noValidate>
      <FormNote state={state} />

      <label className="field">
        <span>Password saat ini</span>
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          minLength={6}
          required
        />
      </label>

      <div className="form-grid">
        <label className="field">
          <span>Password baru</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            placeholder="Minimal 8 karakter"
          />
        </label>

        <label className="field">
          <span>Ulangi password baru</span>
          <input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
      </div>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn--ghost btn--sm" type="submit" disabled={pending}>
          {pending ? "Menyimpan…" : "Ganti password"}
        </button>
      </div>
    </form>
  );
}

export function CredentialsForm({
  email,
  username,
}: {
  email: string;
  username: string | null;
}) {
  return (
    <section className="card">
      <h2 className="card__title">Kredensial akun</h2>
      <p className="copy mt-1">
        Semua akun bisa memakai email atau username untuk masuk. Perubahan email
        dan password meminta password saat ini.
      </p>

      <h3 className="card__label mt-3">Username</h3>
      <UsernameForm username={username} />

      <hr className="hair" />

      <h3 className="card__label">Email</h3>
      <EmailForm email={email} />

      <hr className="hair" />

      <h3 className="card__label">Password</h3>
      <PasswordForm />
    </section>
  );
}