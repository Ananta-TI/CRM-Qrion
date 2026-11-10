"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getNotifications,
  markNotificationsSeen,
  type NotificationItem,
} from "@/app/actions/notifications";
import { IconBell } from "@/components/icons";
import { relativeTime } from "@/lib/domain/tickets";

type NotificationContextValue = {
  items: NotificationItem[];
  seenAt: string | null;
  loaded: boolean;
  reload: () => void;
  markSeen: () => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

/**
 * One feed for the whole shell. The shell mounts two bells (page header +
 * mobile bar) and both stay in the DOM, so fetching from each component meant
 * two identical server-action POSTs on every load. The provider owns the fetch
 * and the read marker; the bells only render it.
 *
 * "Read" is stored on `profiles.notifications_seen_at`, not in localStorage, so
 * opening the bell on one device clears the badge on every device.
 */
export function NotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const feed = await getNotifications();
      setItems(feed.items);

      // Keep the newest marker. Another tab may have marked read while this
      // one was idle, but a stale response must never move the marker back.
      setSeenAt((current) => {
        const remote = feed.seenAt ? new Date(feed.seenAt).getTime() : 0;
        const local = current ? new Date(current).getTime() : 0;
        return remote >= local ? feed.seenAt : current;
      });
    } finally {
      setLoaded(true);
    }
  }, []);

  // Initial fetch.
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

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    setSeenAt((current) => {
      const local = current ? new Date(current).getTime() : 0;
      return local > new Date(now).getTime() ? current : now;
    });
    void markNotificationsSeen();
  }, []);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  const value = useMemo(
    () => ({ items, seenAt, loaded, reload, markSeen }),
    [items, seenAt, loaded, reload, markSeen],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error("NotificationBell must be used inside <NotificationProvider>");
  }
  return ctx;
}

/**
 * The top-right bell. It reads real `ticket_events`, so replies, assignment
 * and status changes show up without a separate notification table.
 */
export function NotificationBell({ staff }: { staff: boolean }) {
  const { items, seenAt, loaded, reload, markSeen } = useNotifications();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
      markSeen();
      reload();
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
              <p className="notif__empty">Belum ada aktivitas.</p>
            )}

            {items.map((item) => {
              const fresh = new Date(item.createdAt).getTime() > seenTime;
              return (
                <Link
                  className={`notif__item${fresh ? " notif__item--unread" : ""}`}
                  href={item.href}
                  key={item.id}
                  prefetch={false}
                  onClick={() => setOpen(false)}
                >
                  <span className="notif__item-top">
                    <span className="code-ref">
                      {item.ticketCode ?? (item.kind === "account" ? "Akun" : "Tiket")}
                    </span>
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
              prefetch={false}
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
