"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isStaff, requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  ESCALATION_LEVELS,
  STATUSES,
  nextLevel,
  slaTarget,
} from "@/lib/domain/tickets";
import type {
  EscalationLevel,
  TicketStatus,
  UrgencyLevel,
} from "@/lib/types/database";
import type { ActionResult } from "./tickets";

/** Revalidate every surface that renders a given ticket. */
function revalidateTicket(id: string) {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/tickets");
  revalidatePath(`/dashboard/tickets/${id}`);
  revalidatePath("/agent");
  revalidatePath("/agent/board");
  revalidatePath(`/agent/tickets/${id}`);
  revalidatePath("/knowledge");
}

async function loadTicket(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", id)
    .single();
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
    return { ok: false, error: "Hanya agen yang dapat mengambil tiket." };
  }

  const { supabase, ticket, error } = await loadTicket(ticketId);
  if (error || !ticket) return { ok: false, error: "Tiket tidak ditemukan." };
  if (ticket.status === "Closed") {
    return { ok: false, error: "Tiket sudah ditutup." };
  }

  const { error: updateError } = await supabase
    .from("tickets")
    .update({
      assignee_id: ticket.assignee_id ?? session.userId,
      status: ticket.status === "Open" ? "In Progress" : ticket.status,
      first_response_at: ticket.first_response_at ?? new Date().toISOString(),
    })
    .eq("id", ticketId);

  if (updateError) return { ok: false, error: updateError.message };

  await logEvent({
    ticketId,
    actorId: session.userId,
    eventType: "assigned",
    to: session.profile.full_name,
    note: ticket.status === "Open" ? "Tiket diambil alih" : "Agen ditambahkan",
  });

  revalidateTicket(ticketId);
  return { ok: true, data: undefined };
}

// =============================================================================
// 2. ESCALATION ROUTING  (L1 -> L2 -> L3)
//    Handing a ticket to technical or management shortens the SLA window, so
//    the deadline is recomputed from the original creation time.
// =============================================================================
const escalateSchema = z.object({
  ticketId: z.string().uuid(),
  targetLevel: z.enum(ESCALATION_LEVELS as [string, ...string[]]),
  reason: z.string().trim().min(5, "Alasan eskalasi minimal 5 karakter.").max(500),
  urgency: z.enum(["Low", "Medium", "High", "Critical"]).optional(),
});

export async function escalateTicket(
  input: z.input<typeof escalateSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!isStaff(session.profile.role)) {
    return { ok: false, error: "Hanya agen yang dapat melakukan eskalasi." };
  }

  const parsed = escalateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const { ticketId, targetLevel, reason, urgency } = parsed.data;
  const { supabase, ticket, error } = await loadTicket(ticketId);
  if (error || !ticket) return { ok: false, error: "Tiket tidak ditemukan." };
  if (ticket.status === "Closed") {
    return { ok: false, error: "Tiket yang sudah ditutup tidak bisa dieskalasi." };
  }

  const level = targetLevel as EscalationLevel;
  if (level === ticket.escalation_level) {
    return { ok: false, error: `Tiket sudah berada di level ${level}.` };
  }
  if (ESCALATION_LEVELS.indexOf(level) < ESCALATION_LEVELS.indexOf(ticket.escalation_level)) {
    return { ok: false, error: "Eskalasi hanya dapat naik, tidak turun." };
  }

  // Escalating to L3 implies management urgency at minimum.
  const nextUrgency: UrgencyLevel =
    (urgency as UrgencyLevel | undefined) ??
    (level === "L3" && ticket.urgency === "Medium" ? "High" : ticket.urgency);

  const target = slaTarget(nextUrgency, level);
  const createdAt = new Date(ticket.created_at).getTime();
  const deadline = new Date(createdAt + target.resolve * 60_000).toISOString();

  const { error: updateError } = await supabase
    .from("tickets")
    .update({
      escalation_level: level,
      urgency: nextUrgency,
      sla_policy_minutes: target.resolve,
      sla_deadline: deadline,
      status: ticket.status === "Open" ? "In Progress" : ticket.status,
      assignee_id: ticket.assignee_id ?? session.userId,
    })
    .eq("id", ticketId);

  if (updateError) return { ok: false, error: updateError.message };

  await supabase.from("messages").insert({
    ticket_id: ticketId,
    author_id: session.userId,
    author_role: "system",
    kind: "system",
    body: `Tiket dieskalasi dari ${ticket.escalation_level} ke ${level}. Alasan: ${reason}. Target SLA baru: ${target.resolve / 60} jam.`,
  });

  await logEvent({
    ticketId,
    actorId: session.userId,
    eventType: "escalated",
    from: ticket.escalation_level,
    to: level,
    note: reason,
  });

  revalidateTicket(ticketId);
  return { ok: true, data: undefined };
}

/** Convenience wrapper for the "naik satu tingkat" button. */
export async function escalateToNextLevel(
  ticketId: string,
  reason: string,
): Promise<ActionResult> {
  const { ticket } = await loadTicket(ticketId);
  if (!ticket) return { ok: false, error: "Tiket tidak ditemukan." };
  const target = nextLevel(ticket.escalation_level);
  if (!target) {
    return { ok: false, error: "Tiket sudah berada di level tertinggi (L3)." };
  }
  return escalateTicket({ ticketId, targetLevel: target, reason });
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
  const { supabase, ticket, error } = await loadTicket(ticketId);
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

  // Customers may only reopen a ticket that is waiting on them.
  if (!actorIsStaff && target !== "In Progress") {
    return { ok: false, error: "Pelanggan hanya dapat membuka kembali tiket." };
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
        ? "Dibuka kembali oleh pelanggan"
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
    return { ok: false, error: "Hanya agen yang dapat mengirim solusi." };
  }

  const parsed = solutionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const { ticketId, body, resolutionSummary } = parsed.data;
  const { supabase, ticket, error } = await loadTicket(ticketId);
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

  // Auto-archive: the resolution summary is written in the update above, so
  // the Knowledge Base already has the article. The event keeps the audit
  // trail honest without asking the agent to fill a second form.
  await logEvent({
    ticketId,
    actorId: session.userId,
    eventType: "knowledge_published",
    note: resolutionSummary ?? body.slice(0, 480),
  });

  await logEvent({
    ticketId,
    actorId: session.userId,
    eventType: "status_changed",
    from: ticket.status,
    to: "Waiting Validation",
    note: "Solusi dikirim ke pelanggan",
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
  const { supabase, ticket, error } = await loadTicket(ticketId);
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
      note: "Divalidasi selesai oleh pelanggan",
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
      note: reason ?? "Dibuka kembali oleh pelanggan",
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
  const { supabase, ticket, error } = await loadTicket(ticketId);
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
  revalidatePath("/knowledge");
  return { ok: true, data: undefined };
}

// =============================================================================
// 7. MESSAGING — append to the complaint thread
// =============================================================================
const messageSchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(1, "Pesan tidak boleh kosong.").max(5000),
  kind: z.enum(["text", "note"]).optional(),
});

export async function sendMessage(
  input: z.input<typeof messageSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Pesan tidak valid." };
  }

  const { ticketId, body, kind } = parsed.data;
  const { supabase, ticket, error } = await loadTicket(ticketId);
  if (error || !ticket) return { ok: false, error: "Tiket tidak ditemukan." };

  const actorIsOwner = ticket.customer_id === session.userId;
  const actorIsStaff = isStaff(session.profile.role);
  if (!actorIsOwner && !actorIsStaff) {
    return { ok: false, error: "Anda tidak punya akses ke tiket ini." };
  }
  if (ticket.status === "Closed" && !actorIsStaff) {
    return { ok: false, error: "Tiket sudah ditutup. Buka kembali untuk membalas." };
  }

  // The customer side of the chat stays locked until a real agent reply lands.
  // System messages and internal notes deliberately do not unlock it; otherwise
  // an auto-generated notice would look like a conversation opener.
  if (!actorIsStaff) {
    const { count, error: countError } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("ticket_id", ticketId)
      .eq("author_role", "agent")
      .neq("kind", "note");

    if (countError) return { ok: false, error: countError.message };
    if (!count) {
      return {
        ok: false,
        error: "Percakapan akan aktif setelah agen mengirim pesan pertama.",
      };
    }
  }

  // Internal notes are for staff eyes only.
  const messageKind = actorIsStaff && kind === "note" ? "note" : "text";

  const { error: insertError } = await supabase.from("messages").insert({
    ticket_id: ticketId,
    author_id: session.userId,
    author_role: actorIsStaff ? "agent" : "customer",
    kind: messageKind,
    body,
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
          note: "Agen membalas tiket",
        });
      }
    }
  }

  revalidateTicket(ticketId);
  return { ok: true, data: undefined };
}

// =============================================================================
// 8. KNOWLEDGE BASE — archive a resolution so it is searchable later
// =============================================================================
const knowledgeSchema = z.object({
  ticketId: z.string().uuid(),
  resolutionSummary: z
    .string()
    .trim()
    .min(10, "Ringkasan resolusi minimal 10 karakter.")
    .max(1000),
  tags: z.array(z.string().trim().max(24)).max(8).optional(),
});

export async function publishToKnowledgeBase(
  input: z.input<typeof knowledgeSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!isStaff(session.profile.role)) {
    return { ok: false, error: "Hanya agen yang dapat mengarsipkan resolusi." };
  }

  const parsed = knowledgeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }

  const { ticketId, resolutionSummary, tags } = parsed.data;
  const { supabase, ticket, error } = await loadTicket(ticketId);
  if (error || !ticket) return { ok: false, error: "Tiket tidak ditemukan." };

  const { error: updateError } = await supabase
    .from("tickets")
    .update({
      resolution_summary: resolutionSummary,
      tags: tags?.length ? tags : ticket.tags,
    })
    .eq("id", ticketId);

  if (updateError) return { ok: false, error: updateError.message };

  await logEvent({
    ticketId,
    actorId: session.userId,
    eventType: "knowledge_published",
    note: resolutionSummary,
  });

  revalidateTicket(ticketId);
  revalidatePath("/knowledge");
  return { ok: true, data: undefined };
}
