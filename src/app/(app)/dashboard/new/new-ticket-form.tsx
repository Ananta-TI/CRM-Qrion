"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { createTicket } from "@/app/actions/tickets";
import { AttachmentDrop, type PendingFile } from "@/components/attachment-drop";
import { IconAlert, IconSend } from "@/components/icons";
import {
  SLA_POLICY,
  TICKET_CATEGORIES,
  URGENCY_STYLE,
  formatDuration,
  triageCategory,
  triageUrgency,
} from "@/lib/domain/tickets";
import { createClient } from "@/lib/supabase/client";
import { uploadAttachments } from "@/lib/upload-attachments";
import type { Programmer, TicketCategory } from "@/lib/types/database";

/**
 * Filing a complaint should feel like writing an email: a subject, a body,
 * and whatever you want to attach.
 *
 * Priority and SLA are the system's call. The employee may either pick a
 * category or let the keyword heuristic guess it, and may choose who should
 * handle the ticket: a specific programmer, or the shared "All" queue.
 */
export function NewTicketForm({
  customerName,
  programmers,
}: {
  customerName: string;
  programmers: Programmer[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [categoryChoice, setCategoryChoice] = useState("auto");
  const [target, setTarget] = useState("all");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // The employee can pick a category, or let the keyword heuristic guess it.
  // Priority always stays the system's call.
  const detectedCategory = useMemo(
    () => triageCategory({ subject, description }),
    [subject, description],
  );
  const category: TicketCategory =
    categoryChoice === "auto"
      ? detectedCategory
      : (categoryChoice as TicketCategory);
  const urgency = useMemo(
    () => triageUrgency({ subject, description, category }),
    [subject, description, category],
  );
  const style = URGENCY_STYLE[urgency];
  const sla = SLA_POLICY.L1[urgency];

  async function uploadFiles(ticketId: string) {
    // A failed attachment should not lose the complaint itself; the catch in
    // submit() still routes the created ticket to its detail page.
    return uploadAttachments(ticketId, files);
  }

  function submit() {
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      // 1. Create the ticket first — its id is the folder the files live in,
      //    and the storage policy keys off that folder.
      const result = await createTicket({
        subject,
        description,
        category: categoryChoice === "auto" ? undefined : category,
        assigneeId: target === "all" ? null : target,
        attachments: [],
      });

      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }

      const ticketId = result.data.id;

      // 2. Push the bytes, then record the manifest on the ticket.
      try {
        const uploaded = await uploadFiles(ticketId);
        if (uploaded.length > 0) {
          const supabase = createClient();
          const { error: attachErr } = await supabase
            .from("tickets")
            .update({ attachments: uploaded })
            .eq("id", ticketId);
          if (attachErr) {
            setError(
              `Tiket dibuat, tetapi lampiran gagal dicatat: ${attachErr.message}`,
            );
          }
        }
      } catch (uploadErr) {
        setError(
          `Tiket sudah dibuat, tetapi ada lampiran yang gagal diunggah: ${
            uploadErr instanceof Error ? uploadErr.message : "tidak diketahui"
          }. Anda masih bisa menambahkannya dari halaman tiket.`,
        );
      }

      router.push(`/dashboard/tickets/${ticketId}?created=1`);
    });
  }

  return (
    <form
      className="split"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <section className="card">
        {error && (
          <p className="form-note form-note--err" style={{ marginBottom: 16 }}>
            {error}
          </p>
        )}

        <div className="stack">
          <label className="field">
            <span>Subjek</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              minLength={3}
              maxLength={160}
              placeholder="Contoh: Pembayaran berhasil tapi pesanan tidak diproses"
            />
            <em className="field__err">{fieldErrors.subject}</em>
          </label>

          <label className="field">
            <span>Ceritakan keluhan Anda</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              minLength={10}
              maxLength={5000}
              rows={9}
              placeholder={"Tulis seperti Anda menulis email.\n\nJelaskan apa yang terjadi, kapan, nomor pesanan bila ada, dan apa yang Anda harapkan."}
            />
            <em className="field__err">{fieldErrors.description}</em>
          </label>

          <label className="field">
            <span>Kategori masalah</span>
            <select
              value={categoryChoice}
              onChange={(e) => setCategoryChoice(e.target.value)}
            >
              <option value="auto">Deteksi otomatis dari tulisan saya</option>
              {TICKET_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <span className="copy" style={{ fontSize: 12 }}>
              Pilih kategori yang paling dekat. Prioritas dan target SLA tetap
              dinilai sistem.
            </span>
            <em className="field__err">{fieldErrors.category}</em>
          </label>

          <label className="field">
            <span>Tujuan penanganan</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="all">Semua programmer</option>
              {programmers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
            <span className="copy" style={{ fontSize: 12 }}>
              {programmers.length === 0
                ? "Belum ada programmer aktif. Tiket akan masuk ke antrian bersama."
                : target === "all"
                  ? "Tiket terlihat oleh semua programmer dan bisa diambil salah satu."
                  : "Tiket hanya terlihat oleh programmer yang dipilih."}
            </span>
            <em className="field__err">{fieldErrors.assigneeId}</em>
          </label>

          <div>
            <p className="card__label">Lampiran</p>
            <AttachmentDrop
              files={files}
              onChange={setFiles}
              disabled={pending}
            />
          </div>

          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <p className="copy" style={{ margin: 0 }}>
              Diajukan sebagai <strong>{customerName}</strong>.
            </p>
            <button className="btn btn--primary" type="submit" disabled={pending}>
              <IconSend /> {pending ? "Mengirim…" : "Kirim Keluhan"}
            </button>
          </div>
        </div>
      </section>

      <aside className="side">
        <section className="card">
          <h2 className="card__title">Sistem yang menilai</h2>
          <p className="copy mt-1">
            Kategori bisa Anda pilih sendiri atau dibiarkan dideteksi dari isi
            keluhan. Prioritas dan target SLA tetap ditetapkan sistem.
          </p>

          <dl className="dl mt-2">
            <div>
              <dt>Kategori</dt>
              <dd>
                {description.length + subject.length >= 3 ? category : "—"}
                {categoryChoice === "auto" && description.length + subject.length >= 3
                  ? " (otomatis)"
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Prioritas</dt>
              <dd>
                <span className={`pill ${style.pill}`}>{style.label}</span>
              </dd>
            </div>
            <div>
              <dt>Target respons</dt>
              <dd>{formatDuration(sla.response / 60)}</dd>
            </div>
            <div>
              <dt>Target selesai</dt>
              <dd>{formatDuration(sla.resolve / 60)}</dd>
            </div>
          </dl>

          {subject.trim().length < 3 && (
            <p className="copy mt-2" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <IconAlert />
              <span>Mulai menulis untuk melihat perkiraan penilaian sistem.</span>
            </p>
          )}
        </section>

        <section className="card">
          <h2 className="card__title">Yang terjadi setelah ini</h2>
          <ol className="timeline mt-2">
            <li className="tl-item">
              <span className="tl-item__dot" />
              <div className="tl-item__body">
                <p className="tl-item__title">Tiket dibuat &amp; dinomori</p>
                <p className="tl-item__note">
                  Anda menerima kode tiket dan target SLA.
                </p>
              </div>
            </li>
            <li className="tl-item">
              <span className="tl-item__dot" />
              <div className="tl-item__body">
                <p className="tl-item__title">Programmer menangani</p>
                <p className="tl-item__note">
                  Anda bisa memantau percakapan dan menambah info.
                </p>
              </div>
            </li>
            <li className="tl-item">
              <span className="tl-item__dot" />
              <div className="tl-item__body">
                <p className="tl-item__title">Solusi &amp; validasi</p>
                <p className="tl-item__note">
                  Tandai selesai, atau kembalikan bila belum.
                </p>
              </div>
            </li>
          </ol>
        </section>
      </aside>
    </form>
  );
}
