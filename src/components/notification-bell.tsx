"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { getNotifications, type NotificationItem } from "@/app/actions/notifications";
import { IconBell } from "@/components/icons";
import { relativeTime } from "@/lib/domain/tickets";
import { markStoredTimestamp, useStoredTimestamp } from "@/lib/use-stored-timestamp";

const SEEN_KEY = "qrion_notif_seen_at";
const SEEN_EVENT = "qrion-notif-seen";

/**
 * The top-right bell. It reads real `ticket_events`, so escalations, replies
 * and status changes show up without a separate notification table.
 *
 * "Read" is a per-browser timestamp: anything newer than the last time the
 * panel was opened counts as unread. That is deliberately simple for the MVP —
 * the bell is a glanceable activity feed, not a per-user inbox.
 */
export function NotificationBell({ staff }: { staff: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const seenAt = useStoredTimestamp(SEEN_KEY, SEEN_EVENT);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const next = await getNotifications();
      setItems(next);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Initial fetch. The "last seen" marker is read by useStoredTimestamp, so
  // there is no setState-in-effect here.
  useEffect(() => {
    void load();
  }, [load]);

  // Refresh when the tab regains focus and every minute while it is open.
  useEffect(() => {
    function onFocus() {
      void load();
    }
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);

    if (next) {
      void load();
      markStoredTimestamp(SEEN_KEY, SEEN_EVENT);
    }
  }

  const seenTime = seenAt ? new Date(seenAt).getTime() : 0;
  const unread = items.filter((item) => {
    const at = new Date(item.createdAt).getTime();
    return Number.isFinite(at) && at > seenTime;
  }).length;

  return (
    <div className="notif" ref={rootRef}>
      <button
        className="icon-btn icon-btn--round notif__btn"
        type="button"
        aria-label={unread > 0 ? `Notifikasi, ${unread} baru` : "Notifikasi"}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Notifikasi"
        onClick={toggle}
      >
        <IconBell />
        {unread > 0 && (
          <span className="notif__dot" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="notif__panel" role="dialog" aria-label="Notifikasi">
          <div className="notif__head">
            <h2 className="notif__title">Notifikasi</h2>
            <span className="notif__count">{items.length} pembaruan</span>
          </div>

          <div className="notif__list">
            {!loaded && <p className="notif__empty">Memuat…</p>}

            {loaded && items.length === 0 && (
              <p className="notif__empty">Belum ada aktivitas tiket.</p>
            )}

            {items.map((item) => {
              const fresh = new Date(item.createdAt).getTime() > seenTime;
              return (
                <Link
                  className={`notif__item${fresh ? " notif__item--unread" : ""}`}
                  href={item.href}
                  key={item.id}
                  onClick={() => setOpen(false)}
                >
                  <span className="notif__item-top">
                    <span className="code-ref">{item.ticketCode}</span>
                    <span className="notif__time">{relativeTime(item.createdAt)}</span>
                  </span>
                  <span className="notif__message">{item.message}</span>
                  {item.subject && (
                    <span className="notif__subject">{item.subject}</span>
                  )}
                </Link>
              );
            })}
          </div>

          <div className="notif__foot">
            <Link
              className="link-btn"
              href={staff ? "/agent/board" : "/dashboard/tickets"}
              onClick={() => setOpen(false)}
            >
              Lihat semua tiket
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
