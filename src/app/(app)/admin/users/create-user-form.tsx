"use client";

import { useState, useTransition } from "react";

import { createUser } from "@/app/actions/admin";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { IconPlus } from "@/components/icons";
import {
  USERNAME_HINT,
  USERNAME_PATTERN,
  suggestUsername,
} from "@/lib/auth/username";
import type { UserRole } from "@/lib/types/database";

const ROLES: { value: UserRole; label: string }[] = [
  { value: "user", label: "Pegawai" },
  { value: "admin", label: "Programmer" },
];

function suggestPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${out}!7`;
}

export function CreateUserForm({ configured }: { configured: boolean }) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await createUser({
        fullName,
        username,
        email: email || undefined,
        password,
        role,
        company: company || undefined,
        phone: phone || undefined,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      const label = ROLES.find((r) => r.value === role)?.label ?? role;
      setNotice(
        `Akun @${username.trim().toLowerCase()} berhasil dibuat sebagai ${label}.`,
      );
      setConfirmOpen(false);
      setFullName("");
      setUsername("");
      setEmail("");
      setPassword("");
      setCompany("");
      setPhone("");
    });
  }

  const roleLabel = ROLES.find((r) => r.value === role)?.label ?? role;

  return (
    <section className="card">
      <h2 className="card__title">Buat akun baru</h2>
      <p className="copy mt-1">
        Akun langsung aktif dan bisa masuk dengan username. Role menentukan area
        yang bisa diakses.
      </p>

      {!configured && (
        <p className="form-note form-note--err mt-2">
          <strong>SUPABASE_SERVICE_ROLE_KEY belum diisi.</strong> Formulir ini
          dinonaktifkan sampai Anda menambahkan key tersebut ke{" "}
          <code>.env.local</code> lalu menjalankan ulang server.
        </p>
      )}

      <form
        className="stack--sm mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setConfirmOpen(true);
        }}
      >
        {error && <p className="form-note form-note--err">{error}</p>}
        {notice && <p className="form-note form-note--ok">{notice}</p>}

        <label className="field">
          <span>Nama lengkap</span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            onBlur={() => {
              if (!username && fullName.trim()) {
                setUsername(suggestUsername(fullName));
              }
            }}
            required
            minLength={2}
            maxLength={80}
            disabled={!configured}
            placeholder="Siti Nurhaliza"
          />
        </label>

        <label className="field">
          <span>Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            pattern={USERNAME_PATTERN}
            required
            minLength={3}
            maxLength={32}
            autoComplete="off"
            disabled={!configured}
            placeholder="siti.nurhaliza"
          />
          <span className="copy" style={{ fontSize: 12 }}>
            {USERNAME_HINT}
          </span>
        </label>

        <label className="field">
          <span>
            Email <em style={{ opacity: 0.6 }}>(opsional)</em>
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!configured}
            placeholder="Kosongkan untuk username@qrion.local"
          />
        </label>

        <label className="field">
          <span>Password awal</span>
          <div className="row" style={{ gap: 8 }}>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              disabled={!configured}
              placeholder="Minimal 8 karakter"
            />
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              disabled={!configured}
              onClick={() => setPassword(suggestPassword())}
            >
              Saran
            </button>
          </div>
        </label>

        <label className="field">
          <span>Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            disabled={!configured}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <div className="form-grid">
          <label className="field">
            <span>Perusahaan</span>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              disabled={!configured}
            />
          </label>
          <label className="field">
            <span>Telepon</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={!configured}
            />
          </label>
        </div>

        <button
          className="btn btn--primary btn--block"
          type="submit"
          disabled={pending || !configured}
        >
          <IconPlus /> {pending ? "Membuat akun…" : "Buat akun"}
        </button>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title="Buat akun ini?"
        body={
          <>
            <strong>{fullName || "Pengguna baru"}</strong> akan dibuat sebagai{" "}
            <strong>{roleLabel}</strong> dengan username{" "}
            <strong>@{username.trim().toLowerCase() || "—"}</strong>. Semua
            programmer akan menerima notifikasi.
          </>
        }
        confirmLabel="Buat akun"
        pending={pending}
        error={error}
        onCancel={() => {
          setConfirmOpen(false);
          setError(null);
        }}
        onConfirm={submit}
      />
    </section>
  );
}