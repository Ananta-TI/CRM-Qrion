"use client";

import { useActionState } from "react";

import { updateProfile, type AuthState } from "@/app/actions/auth";

const ZONES = [
  "GMT+7 · Jakarta",
  "GMT+8 · Makassar",
  "GMT+9 · Jayapura",
  "GMT+0 · London",
  "GMT-5 · New York",
];

export function ProfileForm({
  profile,
}: {
  profile: {
    full_name: string;
    company: string | null;
    phone: string | null;
    timezone: string | null;
  };
}) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    updateProfile,
    {},
  );

  return (
    <form action={action} className="stack mt-2" noValidate>
      {state.error && <p className="form-note form-note--err">{state.error}</p>}
      {state.notice && <p className="form-note form-note--ok">{state.notice}</p>}

      <div className="form-grid">
        <label className="field">
          <span>Nama lengkap</span>
          <input
            name="fullName"
            defaultValue={profile.full_name}
            required
            minLength={2}
            maxLength={80}
          />
        </label>

        <label className="field">
          <span>Zona waktu</span>
          <select name="timezone" defaultValue={profile.timezone ?? ZONES[0]}>
            {ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Perusahaan</span>
          <input
            name="company"
            defaultValue={profile.company ?? ""}
            maxLength={80}
            placeholder="PT Contoh Jaya"
          />
        </label>

        <label className="field">
          <span>Telepon</span>
          <input
            name="phone"
            defaultValue={profile.phone ?? ""}
            maxLength={24}
            placeholder="0812…"
          />
        </label>
      </div>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn--primary" type="submit" disabled={pending}>
          {pending ? "Menyimpan…" : "Simpan perubahan"}
        </button>
      </div>
    </form>
  );
}
