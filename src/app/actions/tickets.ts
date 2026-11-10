"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { attachmentsSchema } from "@/lib/attachment-schema";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  TICKET_CATEGORIES,
  triageCategory,
  triageUrgency,
} from "@/lib/domain/tickets";
import type { Attachment, TicketCategory } from "@/lib/types/database";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * The email-style submission. The caller supplies subject, body, an optional
 * category, and any files they attached. Priority is inferred; the SLA
 * deadline is pinned by a DB trigger.
 */
const createTicketSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(3, "Subjek minimal 3 karakter.")
    .max(160, "Subjek maksimal 160 karakter."),
  description: z
    .string()
    .trim()
    .min(10, "Ceritakan keluhan Anda minimal 10 karakter.")
    .max(5000, "Deskripsi maksimal 5000 karakter."),
  attachments: attachmentsSchema.optional(),
  /** Employee-selected category; omitted means use the keyword heuristic. */
  category: z
    .enum(TICKET_CATEGORIES as [TicketCategory, ...TicketCategory[]])
    .optional(),
  /** Specific programmer, or null/omitted for the shared "All" queue. */
  assigneeId: z.string().uuid("Programmer tujuan tidak valid.").nullable().optional(),
});

export type CreateTicketInput = z.input<typeof createTicketSchema>;

/**
 * TRIAGE ENGINE (client entry point)
 *
 * When a user files a complaint we must:
 *   1. mint a ticket id and code,
 *   2. derive the category and priority from what they wrote,
 *   3. pin the SLA target from the policy table,
 *   4. keep whatever files they attached.
 *
 * The `ticket_code` default and the `tickets_before_write` trigger do (1) and
 * (3) inside Postgres, so the deadline is correct even for rows created
 * outside the app. Step (2) is the heuristic below. The file bytes were
 * already uploaded to storage by the browser; here we only store the manifest.
 */
export async function createTicket(
  input: CreateTicketInput,
): Promise<ActionResult<{ id: string; code: string }>> {
  const session = await requireSession();
  const parsed = createTicketSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { ok: false, error: "Periksa kembali formulir Anda.", fieldErrors };
  }

  const data = parsed.data;
  const supabase = await createClient();

  // The user's own history seeds the transaction snapshot.
  const { data: history } = await supabase
    .from("tickets")
    .select("transaction_ref, transaction_date, transaction_amount, subject, category, status")
    .eq("customer_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(5);

  const transactionHistory = (history ?? []).map((t) => ({
    ref: t.transaction_ref ?? undefined,
    date: t.transaction_date ?? undefined,
    amount: t.transaction_amount ?? undefined,
    status: t.status,
    note: t.subject,
  }));

  // The employee may pick the category; priority stays the system's call.
  const category =
    data.category ??
    triageCategory({
      subject: data.subject,
      description: data.description,
    });
  const urgency = triageUrgency({
    subject: data.subject,
    description: data.description,
    category,
  });

  const attachments: Attachment[] = data.attachments ?? [];

  const { data: created, error } = await supabase
    .from("tickets")
    .insert({
      customer_id: session.userId,
      assignee_id: data.assigneeId ?? null,
      subject: data.subject,
      description: data.description,
      category,
      urgency,
      status: "Open",
      escalation_level: "L1",
      attachments,
      transaction_history: transactionHistory,
      tags: [category.toLowerCase()],
    })
    .select("id, ticket_code")
    .single();

  if (error || !created) {
    return {
      ok: false,
      error:
        error?.message.includes("row-level security") && data.assigneeId
          ? "Programmer tujuan tidak valid. Pilih programmer lain atau target Semua."
          : error?.message ?? "Gagal membuat tiket.",
    };
  }

  // Record the audit trail. The thread intentionally starts empty; the
  // customer can write immediately after the ticket exists.
  await supabase.from("ticket_events").insert({
    ticket_id: created.id,
    actor_id: session.userId,
    event_type: "created",
    to_value: "Open",
    note: `Kategori: ${category} (${
      data.category ? "dipilih pegawai" : "otomatis"
    }) · Prioritas otomatis: ${urgency}${
      data.assigneeId ? " · Ditugaskan ke programmer pilihan" : ""
    }`,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/tickets");
  revalidatePath("/agent");
  revalidatePath("/agent/board");

  return { ok: true, data: { id: created.id, code: created.ticket_code } };
}

