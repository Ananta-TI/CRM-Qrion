"use client";

import { useEffect, useRef, useState } from "react";

import { ChatThread } from "@/components/chat-thread";
import { IconChat, IconClose } from "@/components/icons";
import type { SignedAttachment } from "@/lib/attachments";
import { markStoredTimestamp, useStoredTimestamp } from "@/lib/use-stored-timestamp";
import type { Message } from "@/lib/types/database";

type ThreadMessage = Message & { author_name: string | null };

/**
 * The conversation, lifted out of the ticket detail page into a side drawer.
 *
 * It receives the same `messages` and viewer the page already loaded, so
 * opening it costs no extra round-trip. Built on native <dialog> for focus
 * trapping and Esc; the slide-in animation is disabled under
 * prefers-reduced-motion (see globals.css).
 */
export function ConversationDrawer({
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
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const seenKey = `qrion_thread_seen_${ticketId}`;
  const seenEvent = `qrion-thread-seen-${ticketId}`;
  const seenAt = useStoredTimestamp(seenKey, seenEvent);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const last = messages[messages.length - 1];
  const unread = Boolean(
    last &&
      last.author_id !== viewer.id &&
      (!seenAt ||
        new Date(last.created_at).getTime() > new Date(seenAt).getTime()),
  );

  function openDrawer() {
    setOpen(true);
    markStoredTimestamp(seenKey, seenEvent);
  }

  return (
    <>
      <button
        className="btn btn--ghost convo-btn"
        type="button"
        onClick={openDrawer}
        aria-haspopup="dialog"
      >
        <IconChat /> Percakapan
        {unread && <span className="convo-btn__dot" aria-label="Pesan baru" />}
        {messages.length > 0 && (
          <span className="convo-btn__count">{messages.length}</span>
        )}
      </button>

      <dialog
        className="drawer"
        ref={ref}
        aria-labelledby="convo-title"
        onClose={() => setOpen(false)}
      >
        <div className="drawer__panel">
          <header className="drawer__head">
            <h2 className="drawer__title" id="convo-title">
              Percakapan
            </h2>
            <span className="chip">
              {messages.length} pesan
            </span>
            <button
              className="icon-btn icon-btn--round"
              type="button"
              aria-label="Tutup percakapan"
              onClick={() => setOpen(false)}
            >
              <IconClose />
            </button>
          </header>

          <div className="drawer__body">
            <ChatThread
              ticketId={ticketId}
              messages={messages}
              viewer={viewer}
              canPost={canPost}
              closedNotice={closedNotice}
              attachmentsByMessage={attachmentsByMessage}
            />
          </div>
        </div>
      </dialog>
    </>
  );
}
