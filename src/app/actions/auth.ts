"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { homeFor } from "@/lib/auth/session";

export type AuthState = { error?: string; notice?: string };

const loginSchema = z.object({
  email: z.string().email("Format email tidak valid."),
  password: z.string().min(6, "Password minimal 6 karakter."),
});

const registerSchema = loginSchema.extend({
  fullName: z.string().trim().min(2, "Nama minimal 2 karakter.").max(80),
  company: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(24).optional(),
});

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    return { error: "Email atau password salah." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", data.user.id)
    .single();

  if (!profile) {
    await supabase.auth.signOut();
    return {
      error:
        "Profil tidak ditemukan. Hubungi admin agar akun Anda dilengkapi.",
    };
  }

  revalidatePath("/", "layout");
  redirect(homeFor(profile.role));
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
    company: formData.get("company") || undefined,
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const supabase = await createClient();
  const { email, password, fullName, company, phone } = parsed.data;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // handle_new_user() reads these to build the profile row.
      data: { full_name: fullName, company, phone },
    },
  });

  if (error) {
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
