"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { resetUserPassword, updateUserRole } from "@/app/actions/admin";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { IconLock } from "@/components/icons";
import type { UserRole } from "@/lib/types/database";

const ROLES: { value: UserRole; label: string }[] = [
  { value: "user", label: "Pegawai" },
  { value: "admin", label: "Programmer" },
];

type PendingChange =
  | { kind: "role"; role: UserRole }
  | { kind: "status"; active: boolean }
  | null;

/**
 * One inline control per cell: role select, active toggle, or password reset.
 * All three hit admin-only server actions. Role and status changes are
 * confirmed in a dialog, and every successful change notifies all programmers.
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
  const [pendingChange, setPendingChange] = useState<PendingChange>(null);
  const [roleValue, setRoleValue] = useState<UserRole>(role);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const resetRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = resetRef.current;
    if (!el) return;
    if (dialogOpen && !el.open) el.showModal();
    if (!dialogOpen && el.open) el.close();
  }, [dialogOpen]);

  function cancelChange() {
    setRoleValue(role);
    setPendingChange(null);
    setError(null);
  }

  function confirmChange() {
    if (!pendingChange) return;
    setError(null);

    startTransition(async () => {
      const result = await updateUserRole(
        pendingChange.kind === "role"
          ? { userId, role: pendingChange.role }
          : { userId, role, isActive: pendingChange.active },
      );

      if (!result.ok) {
        setError(result.error);
        return;
      }

      if (pendingChange.kind === "role") {
        setRoleValue(pendingChange.role);
      }
      setPendingChange(null);
    });
  }

  const confirmOpen = pendingChange !== null;
  const roleLabel =
    pendingChange?.kind === "role"
      ? ROLES.find((r) => r.value === pendingChange.role)?.label
      : null;
  const confirmTitle =
    pendingChange?.kind === "role"
      ? "Ubah role pengguna?"
      : pendingChange?.kind === "status"
        ? pendingChange.active
          ? "Aktifkan pengguna?"
          : "Nonaktifkan pengguna?"
        : "";
  const confirmBody =
    pendingChange?.kind === "role"
      ? `Role akan diubah menjadi ${roleLabel}. Semua programmer akan menerima notifikasi.`
      : pendingChange?.kind === "status"
        ? pendingChange.active
          ? "Pengguna bisa masuk dan mengajukan tiket lagi. Semua programmer akan menerima notifikasi."
          : "Pengguna tidak bisa masuk sampai diaktifkan kembali. Semua programmer akan menerima notifikasi."
        : "";

  if (variant === "role") {
    return (
      <div className="stack--sm">
        <select
          value={roleValue}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value as UserRole;
            setRoleValue(next);
            setError(null);
            setPendingChange({ kind: "role", role: next });
          }}
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

        <ConfirmDialog
          open={confirmOpen && pendingChange?.kind === "role"}
          title={confirmTitle}
          body={confirmBody}
          confirmLabel="Ubah role"
          pending={pending}
          error={error}
          onCancel={cancelChange}
          onConfirm={confirmChange}
        />
      </div>
    );
  }

  if (variant === "status") {
    return (
      <>
        <button
          className={`pill ${isActive ? "pill--done" : "pill--crit"}`}
          type="button"
          disabled={pending || (isSelf && isActive)}
          title={
            isSelf && isActive
              ? "Tidak bisa menonaktifkan diri sendiri"
              : undefined
          }
          onClick={() => {
            setError(null);
            setPendingChange({ kind: "status", active: !isActive });
          }}
        >
          <span className={`sw ${isActive ? "sw--done" : "sw--crit"}`} />
          {pending ? "…" : isActive ? "Aktif" : "Nonaktif"}
        </button>
        {error && <em className="field__err">{error}</em>}

        <ConfirmDialog
          open={confirmOpen && pendingChange?.kind === "status"}
          title={confirmTitle}
          body={confirmBody}
          confirmLabel={
            pendingChange?.kind === "status" && pendingChange.active
              ? "Aktifkan"
              : "Nonaktifkan"
          }
          tone={
            pendingChange?.kind === "status" && !pendingChange.active
              ? "danger"
              : "primary"
          }
          pending={pending}
          error={error}
          onCancel={cancelChange}
          onConfirm={confirmChange}
        />
      </>
    );
  }

  return (
    <>
      <button
        className="btn btn--ghost btn--xs"
        type="button"
        disabled={!canProvision}
        title={
          canProvision
            ? "Reset password"
            : "SUPABASE_SERVICE_ROLE_KEY belum diisi"
        }
        onClick={() => setDialogOpen(true)}
      >
        <IconLock /> Reset password
      </button>

      <dialog
        className="dlg"
        ref={resetRef}
        aria-labelledby={`pw-${userId}`}
        onClose={() => {
          if (dialogOpen) {
            setDialogOpen(false);
            setNewPassword("");
            setError(null);
          }
        }}
      >
        <div className="dlg__form">
          <p className="dlg__title" id={`pw-${userId}`}>
            Reset password
          </p>
          <p className="dlg__sub">
            Password baru langsung berlaku dan semua programmer akan menerima
            notifikasi. Sampaikan ke pengguna lewat kanal aman.
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
                  const result = await resetUserPassword({
                    userId,
                    password: newPassword,
                  });
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