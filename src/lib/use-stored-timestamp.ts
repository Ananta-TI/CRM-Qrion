"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Reads a timestamp from localStorage without a setState-in-effect. The
 * server snapshot is `null`, so the first paint is deterministic; after
 * hydration the client snapshot takes over.
 *
 * `markStoredTimestamp` writes the value and fires a same-tab event, because
 * the native `storage` event only reaches other tabs.
 */
export function useStoredTimestamp(key: string, eventName: string): string | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      window.addEventListener(eventName, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(eventName, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    [eventName],
  );

  const getSnapshot = useCallback(
    () => window.localStorage.getItem(key),
    [key],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

export function markStoredTimestamp(
  key: string,
  eventName: string,
  value = new Date().toISOString(),
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
  window.dispatchEvent(new Event(eventName));
}
