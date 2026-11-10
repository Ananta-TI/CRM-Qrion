"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  USERNAME_HINT,
  USERNAME_REGEX,
  normalizeUsername,
} from "@/lib/auth/username";
import type { UserRole } from "@/lib/types/database";

export type AdminActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const createUserSchema = z.object({
  email: z.string().trim().max(160).optional(),
  username: z.string().trim().min(3, "Username minimal 3 karakter.").max(32),
  password: z.string().min(8, "Password minimal 8 karakter.").max(128),
  fullName: z.string().trim().min(2, "Nama minimal 2 karakter.").max(80),
  role: z.enum(["user", "admin"]),
  company: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(24).optional(),
});

const ROLE_LABEL: Record<UserRole, string> = {
  user: "Pegawai",
  admin: "Programmer",
};

/**
 * Account changes are not tickets, so they cannot use `ticket_events`. The
 * RPC fans the notification out to every active programmer. A failed
 * notification must never roll back the account change itself.
 */
async function notifyProgrammers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: { kind: string; title: string; body?: string; href?: string },
) {
  try {
    await supabase.rpc("notify_programmers", {
      p_kind: input.kind,
      p_title: input.title,
      p_body: input.body ?? null,
      p_href: input.href ?? null,
    });
  } catch {
    // The migration may not be applied yet; the account change still stands.
  }
}

/**
 * Admin-only account provisioning.
 *
 * Uses the service_role client because creating an auth user on someone else's
 * behalf is not something the anon key can do. `requireAdmin()` runs first, so
 * only a signed-in admin reaches the privileged call.
 */
export async function createUser(
  input: z.input<typeof createUserSchema>,
): Promise<AdminActionResult<{ id: string }>> {
  await requireAdmin();

  if (!isAdminClientConfigured()) {
    return {
      ok: false,
      error:
        "SUPABASE_SERVICE_ROLE_KEY belum diisi di .env.local, jadi pembuatan akun dari aplikasi dinonaktifkan. Anda masih bisa membuat user lewat Supabase Dashboard.",
    };
  }

  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Input tidak valid.",
    };
  }

  const { password, fullName, role, company, phone } = parsed.data;
  const username = normalizeUsername(parsed.data.username);

  if (!USERNAME_REGEX.test(username)) {
    return { ok: false, error: `Username tidak valid. ${USERNAME_HINT}` };
  }

  // Email is optional: most internal accounts sign in by username and can set
  // a real address later from Pengaturan.
  const email = parsed.data.email?.trim() || `${username}@qrion.local`;
  if (!z.string().email().safeParse(email).success) {
    return { ok: false, error: "Format email tidak valid." };
  }

  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      username,
      company,
      phone,
    },
  });

  if (error || !data.user) {
    const message = error?.message.toLowerCase() ?? "";
    if (
      message.includes("already") ||
      message.includes("duplicate") ||
      message.includes("database error")
    ) {
      return {
        ok: false,
        error: "Email atau username itu sudah dipakai akun lain.",
      };
    }
    return { ok: false, error: error?.message ?? "Gagal membuat akun." };
  }

  // handle_new_user() already inserted the profile as 'user'. Set the role and
  // username explicitly so provisioning also works on a database where the
  // trigger has not been updated yet.
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      role: role as UserRole,
      full_name: fullName,
      username,
      company: company || null,
      phone: phone || null,
    })
    .eq("id", data.user.id);

  if (profileError) {
    // Do not leave a half-provisioned auth user behind.
    await admin.auth.admin.deleteUser(data.user.id);

    const message = profileError.message.toLowerCase();
    return {
      ok: false,
      error: message.includes("duplicate")
        ? "Username sudah dipakai. Ganti username lalu coba lagi."
        : `Gagal melengkapi profil: ${profileError.message}`,
    };
  }

  const supabase = await createClient();
  await notifyProgrammers(supabase, {
    kind: "account",
    title: "Akun baru dibuat",
    body: `${fullName} (@${username}) terdaftar sebagai ${ROLE_LABEL[role]}.`,
    href: "/admin/users",
  });

  revalidatePath("/admin/users");
  return { ok: true, data: { id: data.user.id } };
}

const updateRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["user", "admin"]),
  isActive: z.boolean().optional(),
});

export async function updateUserRole(
  input: z.input<typeof updateRoleSchema>,
): Promise<AdminActionResult> {
  const session = await requireAdmin();
  const parsed = updateRoleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Input tidak valid.",
    };
  }

  const { userId, role, isActive } = parsed.data;

  if (userId === session.userId && role !== "admin") {
    return { ok: false, error: "Anda tidak dapat menurunkan role akun sendiri." };
  }
  if (userId === session.userId && isActive === false) {
    return { ok: false, error: "Anda tidak dapat menonaktifkan akun sendiri." };
  }

  const supabase = await createClient();
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("full_name, role, is_active, username")
    .eq("id", userId)
    .single();

  if (targetError || !target) {
    return { ok: false, error: "Pengguna tidak ditemukan." };
  }

  const roleChanged = target.role !== role;
  const activeChanged =
    isActive !== undefined && target.is_active !== isActive;

  if (!roleChanged && !activeChanged) {
    return { ok: true, data: undefined };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      role: role as UserRole,
      ...(isActive === undefined ? {} : { is_active: isActive }),
    })
    .eq("id", userId);

  if (error) return { ok: false, error: error.message };

  const who = target.username
    ? `${target.full_name} (@${target.username})`
    : target.full_name;
  const changes: string[] = [];
  if (roleChanged) changes.push(`role menjadi ${ROLE_LABEL[role]}`);
  if (activeChanged) {
    changes.push(isActive ? "akses diaktifkan" : "akses dinonaktifkan");
  }

  await notifyProgrammers(supabase, {
    kind: "account",
    title: roleChanged ? "Role pengguna diperbarui" : "Status pengguna diperbarui",
    body: `${who}: ${changes.join(" dan ")}.`,
    href: "/admin/users",
  });

  revalidatePath("/admin/users");
  return { ok: true, data: undefined };
}

const resetSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(8, "Password minimal 8 karakter.").max(128),
});

export async function resetUserPassword(
  input: z.input<typeof resetSchema>,
): Promise<AdminActionResult> {
  await requireAdmin();

  if (!isAdminClientConfigured()) {
    return {
      ok: false,
      error: "SUPABASE_SERVICE_ROLE_KEY belum diisi di .env.local.",
    };
  }

  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Input tidak valid.",
    };
  }

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("full_name, username")
    .eq("id", parsed.data.userId)
    .single();

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(parsed.data.userId, {
    password: parsed.data.password,
  });

  if (error) return { ok: false, error: error.message };

  if (target) {
    const who = target.username
      ? `${target.full_name} (@${target.username})`
      : target.full_name;
    await notifyProgrammers(supabase, {
      kind: "account",
      title: "Password pengguna direset",
      body: `Password ${who} diganti oleh programmer.`,
      href: "/admin/users",
    });
  }

  revalidatePath("/admin/users");
  return { ok: true, data: undefined };
}

/** Housekeeping: flag every ticket that blew its SLA. */
export async function refreshSlaBreaches(): Promise<AdminActionResult<number>> {
  await requireAdmin();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("refresh_sla_breaches");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/agent");
  revalidatePath("/agent/board");
  return { ok: true, data: (data as number) ?? 0 };
}
