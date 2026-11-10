"use client";

import { useRef, useState, useTransition } from "react";

import { sendMessage } from "@/app/actions/workflow";
import { AttachmentDrop, type PendingFile } from "@/components/attachment-drop";
import { AttachmentStrip } from "@/components/attachment-strip";
import { IconSend } from "@/components/icons";
import type { SignedAttachment } from "@/lib/attachments";
import { relativeTime } from "@/lib/domain/tickets";
import { uploadAttachments } from "@/lib/upload-attachments";
import type { Attachment, Message } from "@/lib/types/database";

type ThreadMessage = Message & { author_name: string | null };

/**
 * The complaint chat. `viewer` decides which side of the thread a bubble lands
 * on, and whether internal notes are offered.
 */
export function ChatThread({
  ticketId,
  messages,
  viewer,
  canPost,
  closedNotice,
  attachmentsByMessage,
}: {
  ticketId: string;
  messages: ThreadMessage[];
  viewer: { id: string; role: string };
  canPost: boolean;
  closedNotice?: string;
  attachmentsByMessage?: Record<string, SignedAttachment[]>;
}) {
  const [body, setBody] = useState("");
  const [asNote, setAsNote] = useState(false);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  const isStaff = viewer.role === "admin";

  function clearFiles() {
    for (const item of files) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    setFiles([]);
  }

  function send() {
    const text = body.trim();
    if (!text) return;
    setError(null);

    startTransition(async () => {
      let uploaded: Attachment[] = [];
      try {
        uploaded = await uploadAttachments(ticketId, files);
      } catch (uploadError) {
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "Lampiran gagal diunggah.",
        );
        return;
      }

      const result = await sendMessage({
        ticketId,
        body: text,
        kind: asNote ? "note" : "text",
        attachments: uploaded,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBody("");
      setAsNote(false);
      clearFiles();
      requestAnimationFrame(() =>
        endRef.current?.scrollIntoView({ behavior: "smooth" }),
      );
    });
  }

  return (
    <section className="card">
      {/* The drawer already titles this panel "Percakapan", so the thread keeps
          only the body/composer and no second heading. */}
      <div className="thread">
        {messages.length === 0 && (
          <p className="empty">Belum ada percakapan.</p>
        )}

        {messages.map((m) => {
          const mine = m.author_id === viewer.id;
          const variant = m.author_role === "system"
            ? "msg--system"
            : m.kind === "note"
              ? "msg--note"
              : mine
                ? "msg--out"
                : "";
          const solutionClass = m.kind === "solution" ? "msg--solution" : "";

          if (m.author_role === "system") {
            return (
              <div className="msg msg--system" key={m.id}>
                <div className="msg__body">
                  <p className="msg__text">{m.body}</p>
                  <AttachmentStrip items={attachmentsByMessage?.[m.id] ?? []} />
                </div>
              </div>
            );
          }

          return (
            <div className={`msg ${variant} ${solutionClass}`} key={m.id}>
              <div className="msg__body">
                <div className="msg__head">
                  <span>
                    {m.kind === "note"
                      ? "Catatan internal"
                      : m.author_role === "customer"
                        ? m.author_name ?? "Pegawai"
                        : m.author_name ?? "Programmer"}
                  </span>
                  <span>·</span>
                  <span>{relativeTime(m.created_at)}</span>
                  {m.kind === "solution" && <span>· Solusi</span>}
                </div>
                <p className="msg__text">{m.body}</p>
                <AttachmentStrip items={attachmentsByMessage?.[m.id] ?? []} />
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {canPost ? (
        <div className="composer">
          {error && <p className="form-note form-note--err">{error}</p>}

          <label className="field">
            <span className="sr-only">Tulis pesan</span>
            <textarea
              rows={3}
              value={body}
              maxLength={5000}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                asNote
                  ? "Catatan internal — tidak terlihat oleh pegawai"
                  : isStaff
                    ? "Balas pegawai…"
                    : "Tulis pesan atau tambahan informasi…"
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
            />
          </label>

          <AttachmentDrop
            compact
            files={files}
            onChange={setFiles}
            disabled={pending}
          />

          <div className="composer__row">
            <div className="row row--center">
              {isStaff && (
                <label className="row row--center" style={{ gap: 7, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={asNote}
                    onChange={(e) => setAsNote(e.target.checked)}
                    style={{ width: "auto" }}
                  />
                  Catatan internal
                </label>
              )}
              <span className="copy" style={{ fontSize: 12 }}>
                Ctrl/⌘ + Enter untuk mengirim
              </span>
            </div>
            <button
              className="btn btn--primary btn--sm"
              type="button"
              disabled={pending || !body.trim()}
              onClick={send}
            >
              <IconSend /> {pending ? "Mengirim…" : "Kirim"}
            </button>
          </div>
        </div>
      ) : (
        <p className="copy mt-2" style={{ textAlign: "center" }}>
          {closedNotice ?? "Percakapan ditutup."}
        </p>
      )}
    </section>
  );
}
