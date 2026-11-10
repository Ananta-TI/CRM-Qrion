"use client";

import { useActionState } from "react";

import { signIn, type AuthState } from "@/app/actions/auth";

export function LoginForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(signIn, {});

  return (
    <form action={action} className="stack" noValidate>
      {state.error && <p className="form-note form-note--err">{state.error}</p>}
      {state.notice && <p className="form-note form-note--ok">{state.notice}</p>}

      <label className="field">
        <span>Email atau username</span>
        <input
          name="identifier"
          required
          minLength={3}
          autoComplete="username"
          placeholder="nama@perusahaan.com atau bang.ridho"
        />
      </label>

      <label className="field">
        <span>Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete="current-password"
          placeholder="••••••••"
        />
      </label>

      <button className="btn btn--primary btn--block" type="submit" disabled={pending}>
        {pending ? "Memproses…" : "Masuk"}
      </button>
    </form>
  );
}
