"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isAdminClientConfigured, createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { homeFor } from "@/lib/auth/session";
import {
  USERNAME_HINT,
  USERNAME_REGEX,
  normalizeUsername,
} from "@/lib/auth/username";

export type AuthState = { error?: string; notice?: string };

const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(3, "Isi email atau username Anda.")
    .max(160, "Email atau username terlalu panjang."),
  password: z.string().min(6, "Password minimal 6 karakter."),
});

const registerSchema = loginSchema.extend({
  identifier: z.string().trim().email("Format email tidak valid."),
  fullName: z.string().trim().min(2, "Nama minimal 2 karakter.").max(80),
  username: z.string().trim().max(32).optional(),
  company: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(24).optional(),
});

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const supabase = await createClient();
  let email = parsed.data.identifier;

  // A username is resolved to its login email through a narrow SECURITY
  // DEFINER function; the password is still checked by Supabase Auth.
  if (!email.includes("@")) {
    const { data, error } = await supabase.rpc("email_for_username", {
      p_username: normalizeUsername(email),
    });

    if (error || !data) {
      return { error: "Email/username atau password salah." };
    }
    email = data;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    return { error: "Email/username atau password salah." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, is_active")
    .eq("id", data.user.id)
    .single();

  if (!profile) {
    await supabase.auth.signOut();
    return {
      error:
        "Profil tidak ditemukan. Hubungi admin agar akun Anda dilengkapi.",
    };
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    return { error: "Akun ini dinonaktifkan. Hubungi programmer." };
  }

  revalidatePath("/", "layout");
  redirect(homeFor(profile.role));
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = registerSchema.safeParse({
    identifier: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
    username: formData.get("username") || undefined,
    company: formData.get("company") || undefined,
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const { identifier: email, password, fullName, company, phone } = parsed.data;
  const username = parsed.data.username
    ? normalizeUsername(parsed.data.username)
    : null;

  if (username && !USERNAME_REGEX.test(username)) {
    return { error: `Username tidak valid. ${USERNAME_HINT}` };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // handle_new_user() reads these to build the profile row.
      data: {
        full_name: fullName,
        company,
        phone,
        ...(username ? { username } : {}),
      },
    },
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("database error") || message.includes("duplicate")) {
      return {
        error:
          "Email sudah terdaftar atau username sudah dipakai. Coba yang lain.",
      };
    }
    return { error: error.message };
  }

  // With email confirmation enabled Supabase returns no session here.
  if (!data.session) {
    return {
      notice:
        "Akun dibuat. Cek email Anda untuk konfirmasi, lalu masuk kembali.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  company: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(24).optional(),
  timezone: z.string().trim().max(48).optional(),
});

export async function updateProfile(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sesi berakhir. Silakan masuk kembali." };

  const parsed = profileSchema.safeParse({
    fullName: formData.get("fullName"),
    company: formData.get("company") || undefined,
    phone: formData.get("phone") || undefined,
    timezone: formData.get("timezone") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const { fullName, company, phone, timezone } = parsed.data;

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      company: company || null,
      phone: phone || null,
      timezone: timezone || null,
    })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { notice: "Perubahan tersimpan." };
}

// ---------------------------------------------------------------------------
// Self-service credentials
// ---------------------------------------------------------------------------

const usernameChangeSchema = z.object({
  username: z.string().trim().min(1, "Username wajib diisi.").max(32),
});

export async function updateUsername(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sesi berakhir. Silakan masuk kembali." };

  const parsed = usernameChangeSchema.safeParse({
    username: formData.get("username"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const username = normalizeUsername(parsed.data.username);
  if (!USERNAME_REGEX.test(username)) {
    return { error: `Username tidak valid. ${USERNAME_HINT}` };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ username })
    .eq("id", user.id);

  if (error) {
    if (
      error.code === "23505" ||
      error.message.toLowerCase().includes("duplicate")
    ) {
      return { error: "Username itu sudah dipakai. Pilih yang lain." };
    }
    if (error.message.includes("profiles_username_format")) {
      return { error: `Username tidak valid. ${USERNAME_HINT}` };
    }
    return { error: error.message };
  }

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { notice: `Username sekarang @${username}.` };
}

const emailChangeSchema = z.object({
  email: z.string().trim().email("Format email tidak valid.").max(160),
  currentPassword: z.string().min(6, "Masukkan password saat ini."),
});

export async function updateEmail(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return { error: "Sesi berakhir. Silakan masuk kembali." };
  }

  const parsed = emailChangeSchema.safeParse({
    email: formData.get("email"),
    currentPassword: formData.get("currentPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const email = parsed.data.email.toLowerCase();
  if (email === user.email.toLowerCase()) {
    return { notice: "Email tersebut sudah dipakai akun ini." };
  }

  // Re-authenticate before touching the login identity.
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });
  if (verifyError) {
    return { error: "Password saat ini salah." };
  }

  if (!isAdminClientConfigured()) {
    // Fallback: Supabase sends a confirmation to the new address. The profile
    // email is synced by the auth trigger after confirmation.
    const { error } = await supabase.auth.updateUser({ email });
    if (error) return { error: error.message };
    return {
      notice:
        "Permintaan perubahan email dikirim. Buka tautan konfirmasi di kotak masuk email baru Anda.",
    };
  }

  // Internal accounts start with placeholder addresses, so an admin-confirmed
  // change is the reliable path: it applies immediately after the password
  // check above.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    email,
    email_confirm: true,
  });
  if (error) return { error: error.message };

  const { error: profileError } = await admin
    .from("profiles")
    .update({ email })
    .eq("id", user.id);

  if (profileError) {
    return {
      error: `Email login berubah, tetapi profil gagal disinkronkan: ${profileError.message}`,
    };
  }

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { notice: `Email sekarang ${email}.` };
}

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(6, "Masukkan password saat ini."),
    password: z.string().min(8, "Password baru minimal 8 karakter.").max(128),
    confirmPassword: z.string().min(8, "Konfirmasi password minimal 8 karakter."),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Konfirmasi password tidak sama.",
    path: ["confirmPassword"],
  });

export async function updatePassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return { error: "Sesi berakhir. Silakan masuk kembali." };
  }

  const parsed = passwordChangeSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });
  if (verifyError) {
    return { error: "Password saat ini salah." };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) return { error: error.message };

  // Keep the current session, drop any other device.
  await supabase.auth.signOut({ scope: "others" });

  return {
    notice: "Password berhasil diganti. Perangkat lain sudah dikeluarkan.",
  };
}
