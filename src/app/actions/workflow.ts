"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { attachmentsSchema } from "@/lib/attachment-schema";
import { isStaff, requireSession, type Session } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  REOPEN_WINDOW_DAYS,
  STATUSES,
  TICKET_CATEGORIES,
  canCustomerReopen,
} from "@/lib/domain/tickets";
import type { TicketCategory, TicketStatus } from "@/lib/types/database";
import type { ActionResult } from "./tickets";

/** Revalidate every surface that renders a given ticket. */
function revalidateTicket(id: string) {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/tickets");
  revalidatePath(`/dashboard/tickets/${id}`);
  revalidatePath("/agent");
  revalidatePath("/agent/board");
  revalidatePath(`/agent/tickets/${id}`);
}

async function loadTicket(id: string, session: Session) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", id)
    .single();

  // RLS is the real gate. Repeat the rule in application code so a missing or
  // regressed policy cannot let a server action act on another programmer's
  // ticket.
  if (data) {
    const owns = data.customer_id === session.userId;
    const staffCanHandle =
      isStaff(session.profile.role) &&
      (data.assignee_id === null || data.assignee_id === session.userId);

    if (!owns && !staffCanHandle) {
      return { supabase, ticket: null, error: new Error("forbidden") };
    }
  }

  return { supabase, ticket: data, error };
}

async function logEvent(input: {
  ticketId: string;
  actorId: string;
  eventType: string;
  from?: string | null;
  to?: string | null;
  note?: string | null;
}) {
  const supabase = await createClient();
  await supabase.from("ticket_events").insert({
    ticket_id: input.ticketId,
    actor_id: input.actorId,
    event_type: input.eventType,
    from_value: input.from ?? null,
    to_value: input.to ?? null,
    note: input.note ?? null,
  });
}

// =============================================================================
// 1. AGENT PICKS UP A TICKET  (Open -> In Progress, assign self)
// =============================================================================
export async function claimTicket(ticketId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isStaff(session.profile.role)) {
    return { ok: false, error: "Hanya programmer yang dapat mengambil tiket." };
  }

  const { supabase, ticket, error } = await loadTicket(ticketId, session);
  if (error || !ticket) return { ok: false, error: "Tiket tidak ditemukan." };
  if (ticket.status === "Closed") {
    return { ok: false, error: "Tiket sudah ditutup." };
  }

  // The `assignee_id is null` predicate is the lock. Two agents can press the
  // button at the same instant; Postgres serialises the row updates and exactly
  // one of them matches the predicate. The loser gets 0 rows back.
  const { data: claimed, error: updateError } = await supabase
    .from("tickets")
    .update({
      assignee_id: session.userId,
      status: ticket.status === "Open" ? "In Progress" : ticket.status,
      first_response_at: ticket.first_response_at ?? new Date().toISOString(),
    })
    .eq("id", ticketId)
    .is("assignee_id", null)
    .neq("status", "Closed")
    .select("id");

  if (updateError) return { ok: false, error: updateError.message };

  if (!claimed || claimed.length === 0) {
    // Re-read so the message reflects what actually happened, not the stale
    // row the page loaded a moment ago.
    const { data: current } = await supabase
      .from("tickets")
      .select("assignee_id, status")
      .eq("id", ticketId)
      .single();

    if (current?.assignee_id === session.userId) {
      return { ok: true, data: undefined };
    }
    if (current?.status === "Closed") {
      return { ok: false, error: "Tiket sudah ditutup." };
    }
    return {
      ok: false,
      error: "Tiket sudah diambil oleh programmer lain. Silakan pilih tiket lain.",
    };
  }

  await logEvent({
    ticketId,
    actorId: session.userId,
    eventType: "assigned",
    to: session.profile.full_name,
    note: "Tiket diambil alih",
  });

  revalidateTicket(ticketId);
  return { ok: true, data: undefined };
}

// =============================================================================
// 2. MANUAL TRIAGE CORRECTION
//    The keyword heuristic is a starting point, not a verdict. A programmer can
//    fix the category/priority in place.
// =============================================================================
const classificationSchema = z.object({
  ticketId: z.string().uuid(),
  category: z.enum(TICKET_CATEGORIES as [TicketCategory, ...TicketCategory[]]),
  urgency: z.enum(["Low", "Medium", "High", "Critical"]),
});

export async function updateTicketClassification(
  input: z.input<typeof classificationSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!isStaff(session.profile.role)) {
    return { ok: false, error: "Hanya programmer yang dapat mengoreksi klasifikasi." };
  }

  const parsed = classificationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const { ticketId, category, urgency } = parsed.data;
  const { supabase, ticket, error } = await loadTicket(ticketId, session);
  if (error || !ticket) return { ok: false, error: "Tiket tidak ditemukan." };
  if (ticket.status === "Closed") {
    return { ok: false, error: "Tiket yang sudah ditutup tidak bisa diubah klasifikasinya." };
  }
  if (ticket.category === category && ticket.urgency === urgency) {
    return { ok: true, data: undefined };
  }

  const urgencyChanged = ticket.urgency !== urgency;

  const { error: updateError } = await supabase
    .from("tickets")
    .update({
      category,
      urgency,
      // The trigger recomputes the deadline from the new priority. A corrected
      // priority should not keep a breach that belonged to the wrong target.
      ...(urgencyChanged ? { sla_breached: false } : {}),
    })
    .eq("id", ticketId);

  if (updateError) return { ok: false, error: updateError.message };

  await logEvent({
    ticketId,
    actorId: session.userId,
    eventType: "triage_corrected",
    from: `${ticket.category} · ${ticket.urgency}`,
    to: `${category} · ${urgency}`,
    note: "Koreksi klasifikasi manual oleh programmer",
  });

  revalidateTicket(ticketId);
  return { ok: true, data: undefined };
}

// =============================================================================
// 3. STATUS CHANGE (generic, guarded by the transition table)
// =============================================================================
const statusSchema = z.object({
  ticketId: z.string().uuid(),
  status: z.enum(STATUSES as [string, ...string[]]),
  note: z.string().trim().max(1000).optional(),
});

export async function updateTicketStatus(
  input: z.input<typeof statusSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const { ticketId, status, note } = parsed.data;
  const { supabase, ticket, error } = await loadTicket(ticketId, session);
  if (error || !ticket) return { ok: false, error: "Tiket tidak ditemukan." };

  const actorIsStaff = isStaff(session.profile.role);
  const actorIsOwner = ticket.customer_id === session.userId;
  if (!actorIsStaff && !actorIsOwner) {
    return { ok: false, error: "Anda tidak punya akses ke tiket ini." };
  }

  const target = status as TicketStatus;
  if (target === ticket.status) {
    return { ok: true, data: undefined };
  }

  // Customers may only reopen a Closed ticket, and only inside the window.
  // After that they must file a new complaint so the old SLA/history stays
  // intact.
  if (!actorIsStaff) {
    if (target !== "In Progress") {
      return { ok: false, error: "Hanya pegawai pemilik tiket yang dapat membuka kembali." };
    }
    if (ticket.status !== "Closed") {
      return {
        ok: false,
        error: "Hanya tiket yang sudah ditutup yang dapat dibuka kembali.",
      };
    }
    if (!canCustomerReopen(ticket.closed_at)) {
      return {
        ok: false,
        error: `Batas waktu membuka kembali tiket adalah ${REOPEN_WINDOW_DAYS} hari setelah ditutup. Silakan buat tiket baru.`,
      };
    }
  }

  const { error: updateError } = await supabase
    .from("tickets")
    .update({
      status: target,
      ...(target === "In Progress" && !actorIsStaff
        ? {
            reopen_count: ticket.reopen_count + 1,
            resolved_at: null,
            closed_at: null,
            csat_score: null,
            csat_comment: null,
            csat_at: null,
          }
        : {}),
    })
    .eq("id", ticketId);

  if (updateError) return { ok: false, error: updateError.message };

  await logEvent({
    ticketId,
    actorId: session.userId,
    eventType: "status_changed",
    from: ticket.status,
    to: target,
    note:
      note ??
      (!actorIsStaff && target === "In Progress"
        ? "Dibuka kembali oleh pegawai"
        : null),
  });

  revalidateTicket(ticketId);
  return { ok: true, data: undefined };
}

// =============================================================================
// 4. AGENT PROPOSES A SOLUTION  -> status becomes Waiting Validation
// =============================================================================
const solutionSchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(10, "Jelaskan solusinya minimal 10 karakter.").max(5000),
  resolutionSummary: z.string().trim().max(500).optional(),
});

export async function proposeSolution(
  input: z.input<typeof solutionSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!isStaff(session.profile.role)) {
    return { ok: false, error: "Hanya programmer yang dapat mengirim solusi." };
  }

  const parsed = solutionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const { ticketId, body, resolutionSummary } = parsed.data;
  const { supabase, ticket, error } = await loadTicket(ticketId, session);
  if (error || !ticket) return { ok: false, error: "Tiket tidak ditemukan." };
  if (ticket.status === "Closed") {
    return { ok: false, error: "Tiket sudah ditutup." };
  }

  // 1. Post the solution as part of the thread.
  const { error: messageError } = await supabase.from("messages").insert({
    ticket_id: ticketId,
    author_id: session.userId,
    author_role: "agent",
    kind: "solution",
    body,
  });
  if (messageError) return { ok: false, error: messageError.message };

  // 2. Park the ticket with the customer.
  const { error: updateError } = await supabase
    .from("tickets")
    .update({
      status: "Waiting Validation",
      resolved_at: new Date().toISOString(),
      first_response_at: ticket.first_response_at ?? new Date().toISOString(),
      assignee_id: ticket.assignee_id ?? session.userId,
      resolution_summary: resolutionSummary ?? body.slice(0, 480),
    })
    .eq("id", ticketId);

  if (updateError) return { ok: false, error: updateError.message };

  await logEvent({
    ticketId,
    actorId: session.userId,
    eventType: "status_changed",
    from: ticket.status,
    to: "Waiting Validation",
    note: "Solusi dikirim ke pegawai",
  });

  revalidateTicket(ticketId);
  return { ok: true, data: undefined };
}

// =============================================================================
// 5. CUSTOMER VALIDATION
//    "Masalah Selesai"  -> Closed
//    "Belum Selesai"    -> In Progress (ticket bounces back to the agent)
// =============================================================================
const validationSchema = z.object({
  ticketId: z.string().uuid(),
  satisfied: z.boolean(),
  reason: z.string().trim().max(1000).optional(),
});

export async function validateResolution(
  input: z.input<typeof validationSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = validationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const { ticketId, satisfied, reason } = parsed.data;
  const { supabase, ticket, error } = await loadTicket(ticketId, session);
  if (error || !ticket) return { ok: false, error: "Tiket tidak ditemukan." };

  const actorIsOwner = ticket.customer_id === session.userId;
  if (!actorIsOwner && !isStaff(session.profile.role)) {
    return { ok: false, error: "Anda tidak punya akses ke tiket ini." };
  }
  if (ticket.status !== "Waiting Validation") {
    return {
      ok: false,
      error: "Tiket ini sedang tidak menunggu validasi.",
    };
  }

  if (satisfied) {
    const { error: updateError } = await supabase
      .from("tickets")
      .update({
        status: "Closed",
        resolved_at: ticket.resolved_at ?? new Date().toISOString(),
        closed_at: new Date().toISOString(),
      })
      .eq("id", ticketId);
    if (updateError) return { ok: false, error: updateError.message };

    await logEvent({
      ticketId,
      actorId: session.userId,
      eventType: "status_changed",
      from: "Waiting Validation",
      to: "Closed",
      note: "Divalidasi selesai oleh pegawai",
    });
  } else {
    // Reopen: bounce straight back to the agent, count it, and clear the
    // previous solution state so CSAT must be re-collected later.
    const { error: updateError } = await supabase
      .from("tickets")
      .update({
        status: "In Progress",
        reopen_count: ticket.reopen_count + 1,
        resolved_at: null,
      })
      .eq("id", ticketId);
    if (updateError) return { ok: false, error: updateError.message };

    await supabase.from("messages").insert({
      ticket_id: ticketId,
      author_id: session.userId,
      author_role: "customer",
      kind: "text",
      body: reason?.trim()
        ? `Masalah belum selesai: ${reason.trim()}`
        : "Masalah belum selesai, mohon ditindaklanjuti kembali.",
    });

    await logEvent({
      ticketId,
      actorId: session.userId,
      eventType: "status_changed",
      from: "Waiting Validation",
      to: "In Progress",
      note: reason ?? "Dibuka kembali oleh pegawai",
    });
  }

  revalidateTicket(ticketId);
  return { ok: true, data: undefined };
}

// =============================================================================
// 6. CSAT — collected from the modal shown right after a ticket closes
// =============================================================================
const csatSchema = z.object({
  ticketId: z.string().uuid(),
  score: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

export async function submitCsat(
  input: z.input<typeof csatSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = csatSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const { ticketId, score, comment } = parsed.data;
  const { supabase, ticket, error } = await loadTicket(ticketId, session);
  if (error || !ticket) return { ok: false, error: "Tiket tidak ditemukan." };
  if (ticket.customer_id !== session.userId) {
    return { ok: false, error: "Hanya pemilik tiket yang dapat mengisi survei." };
  }
  if (ticket.status !== "Closed") {
    return { ok: false, error: "Survei hanya tersedia untuk tiket yang sudah ditutup." };
  }

  const { error: updateError } = await supabase
    .from("tickets")
    .update({
      csat_score: score,
      csat_comment: comment?.trim() || null,
      csat_at: new Date().toISOString(),
    })
    .eq("id", ticketId);

  if (updateError) return { ok: false, error: updateError.message };

  await logEvent({
    ticketId,
    actorId: session.userId,
    eventType: "csat",
    to: String(score),
    note: comment?.trim() || null,
  });

  revalidateTicket(ticketId);
  return { ok: true, data: undefined };
}

// =============================================================================
// 7. MESSAGING — append to the complaint thread
// =============================================================================
const messageSchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(1, "Pesan tidak boleh kosong.").max(5000),
  kind: z.enum(["text", "note"]).optional(),
  attachments: attachmentsSchema.optional(),
});

export async function sendMessage(
  input: z.input<typeof messageSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Pesan tidak valid." };
  }

  const { ticketId, body, kind, attachments } = parsed.data;
  const { supabase, ticket, error } = await loadTicket(ticketId, session);
  if (error || !ticket) return { ok: false, error: "Tiket tidak ditemukan." };

  const actorIsOwner = ticket.customer_id === session.userId;
  const actorIsStaff = isStaff(session.profile.role);
  if (!actorIsOwner && !actorIsStaff) {
    return { ok: false, error: "Anda tidak punya akses ke tiket ini." };
  }
  if (ticket.status === "Closed" && !actorIsStaff) {
    return { ok: false, error: "Tiket sudah ditutup. Buka kembali untuk membalas." };
  }

  // A message may only reference files inside its own ticket folder.
  const attachmentList = attachments ?? [];
  if (attachmentList.some((a) => !a.path.startsWith(`${ticketId}/`))) {
    return { ok: false, error: "Lampiran tidak valid untuk tiket ini." };
  }

  // Internal notes are for staff eyes only.
  const messageKind = actorIsStaff && kind === "note" ? "note" : "text";

  const { error: insertError } = await supabase.from("messages").insert({
    ticket_id: ticketId,
    author_id: session.userId,
    author_role: actorIsStaff ? "agent" : "customer",
    kind: messageKind,
    body,
    attachments: attachmentList,
  });
  if (insertError) return { ok: false, error: insertError.message };

  // Feed the notification bell. Internal notes never leave the staff room, so
  // they are intentionally not written as events.
  if (messageKind !== "note") {
    await logEvent({
      ticketId,
      actorId: session.userId,
      eventType: "message",
      to: actorIsStaff ? "agent" : "customer",
      note: body.slice(0, 140),
    });
  }

  // A customer reply is an implicit resume; make sure the ticket is live.
  if (actorIsStaff) {
    await supabase
      .from("tickets")
      .update({ first_response_at: ticket.first_response_at ?? new Date().toISOString() })
      .eq("id", ticketId)
      .is("first_response_at", null);

    // An agent replying to a reopened ticket puts it back in progress.
    if (ticket.status === "Open") {
      const { error: statusError } = await supabase
        .from("tickets")
        .update({ status: "In Progress" })
        .eq("id", ticketId);

      if (!statusError) {
        await logEvent({
          ticketId,
          actorId: session.userId,
          eventType: "status_changed",
          from: "Open",
          to: "In Progress",
          note: "Programmer membalas tiket",
        });
      }
    }
  }

  revalidateTicket(ticketId);
  return { ok: true, data: undefined };
}

