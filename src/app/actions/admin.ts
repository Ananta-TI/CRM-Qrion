"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/database";

export type AdminActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const createUserSchema = z.object({
  email: z.string().email("Format email tidak valid."),
  password: z.string().min(8, "Password minimal 8 karakter."),
  fullName: z.string().trim().min(2, "Nama minimal 2 karakter.").max(80),
  role: z.enum(["user", "admin"]),
  company: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(24).optional(),
});

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
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const { email, password, fullName, role, company, phone } = parsed.data;
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, company, phone },
  });

  if (error || !data.user) {
    return { ok: false, error: error?.message ?? "Gagal membuat akun." };
  }

  // handle_new_user() already inserted the profile as 'user'; set the
  // requested role now.
  const { error: roleError } = await admin
    .from("profiles")
    .update({ role: role as UserRole, full_name: fullName })
    .eq("id", data.user.id);

  if (roleError) {
    return {
      ok: false,
      error: `Akun dibuat, tapi gagal menetapkan role: ${roleError.message}`,
    };
  }

  revalidatePath("/admin/users");
  return { ok: true, data: { id: data.user.id } };
}

const updateRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["user", "admin"]),
  isActive: z.coerce.boolean().optional(),
});

export async function updateUserRole(
  input: z.input<typeof updateRoleSchema>,
): Promise<AdminActionResult> {
  const session = await requireAdmin();
  const parsed = updateRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const { userId, role, isActive } = parsed.data;

  if (userId === session.userId && role !== "admin") {
    return { ok: false, error: "Anda tidak dapat menurunkan role akun sendiri." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      role: role as UserRole,
      ...(isActive === undefined ? {} : { is_active: isActive }),
    })
    .eq("id", userId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/users");
  return { ok: true, data: undefined };
}

const resetSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(8, "Password minimal 8 karakter."),
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
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(parsed.data.userId, {
    password: parsed.data.password,
  });

  if (error) return { ok: false, error: error.message };

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
  revalidatePath("/knowledge");
  return { ok: true, data: (data as number) ?? 0 };
}
