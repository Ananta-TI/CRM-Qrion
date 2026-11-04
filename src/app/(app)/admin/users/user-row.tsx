"use client";

import { useState, useTransition } from "react";

import { resetUserPassword, updateUserRole } from "@/app/actions/admin";
import { IconLock } from "@/components/icons";
import type { UserRole } from "@/lib/types/database";

const ROLES: { value: UserRole; label: string }[] = [
  { value: "user", label: "Pengguna" },
  { value: "admin", label: "Admin" },
];

/**
 * One inline control per cell: role select, active toggle, or password reset.
 * All three hit admin-only server actions.
 */
export function UserRow({
  userId,
  role,
  isActive,
  isSelf,
  canProvision,
  variant,
}: {
  userId: string;
  role: UserRole;
  isActive: boolean;
  isSelf: boolean;
  canProvision: boolean;
  variant: "role" | "status" | "password";
}) {
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [pending, startTransition] = useTransition();

  if (variant === "role") {
    return (
      <div className="stack--sm">
        <select
          value={role}
          disabled={pending}
          onChange={(e) =>
            startTransition(async () => {
              const result = await updateUserRole({
                userId,
                role: e.target.value as UserRole,
              });
              setError(result.ok ? null : result.error);
            })
          }
          style={{
            background: "var(--panel)",
            border: "1px solid transparent",
            borderRadius: 10,
            padding: "7px 10px",
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        {error && <em className="field__err">{error}</em>}
      </div>
    );
  }

  if (variant === "status") {
    return (
      <button
        className={`pill ${isActive ? "pill--done" : "pill--crit"}`}
        type="button"
        disabled={pending || (isSelf && isActive)}
        title={isSelf && isActive ? "Tidak bisa menonaktifkan diri sendiri" : undefined}
        onClick={() =>
          startTransition(async () => {
            const result = await updateUserRole({ userId, role, isActive: !isActive });
            setError(result.ok ? null : result.error);
          })
        }
      >
        <span className={`sw ${isActive ? "sw--done" : "sw--crit"}`} />
        {pending ? "…" : isActive ? "Aktif" : "Nonaktif"}
      </button>
    );
  }

  return (
    <>
      <button
        className="btn btn--ghost btn--xs"
        type="button"
        disabled={!canProvision}
        title={canProvision ? "Reset password" : "Butuh SUPABASE_SERVICE_ROLE_KEY"}
        onClick={() => setDialogOpen(true)}
      >
        <IconLock /> Reset password
      </button>

      <dialog className="dlg" open={dialogOpen} aria-labelledby={`pw-${userId}`}>
        <div className="dlg__form">
          <p className="dlg__title" id={`pw-${userId}`}>
            Reset password
          </p>
          <p className="dlg__sub">
            Password baru langsung berlaku. Sampaikan ke pengguna lewat kanal aman.
          </p>

          {error && <p className="form-note form-note--err">{error}</p>}

          <label className="field">
            <span>Password baru</span>
            <input
              type="text"
              value={newPassword}
              minLength={8}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimal 8 karakter"
            />
          </label>

          <div className="dlg__row">
            <button
              className="btn btn--ghost"
              type="button"
              onClick={() => {
                setDialogOpen(false);
                setNewPassword("");
                setError(null);
              }}
            >
              Batal
            </button>
            <button
              className="btn btn--primary"
              type="button"
              disabled={pending || newPassword.length < 8}
              onClick={() =>
                startTransition(async () => {
                  const result = await resetUserPassword({ userId, password: newPassword });
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setDialogOpen(false);
                  setNewPassword("");
                  setError(null);
                })
              }
            >
              {pending ? "Menyimpan…" : "Simpan password"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
