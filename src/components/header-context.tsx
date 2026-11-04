"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

export type Crumb = { label: string; href?: string };

/**
 * What a page contributes to the persistent header. The header itself is
 * rendered once by the layout, so the <header> element is never remounted
 * during navigation — only this content changes.
 */
export type HeaderSpec = {
  title: string;
  crumbs?: Crumb[];
  sub?: string;
  actions?: React.ReactNode;
};

type HeaderContextValue = {
  spec: HeaderSpec | null;
  setSpec: (spec: HeaderSpec | null) => void;
};

const HeaderContext = createContext<HeaderContextValue | null>(null);

export function HeaderProvider({ children }: { children: React.ReactNode }) {
  const [spec, setSpecState] = useState<HeaderSpec | null>(null);

  // Identity-stable setter — pages call it from a layout effect, so it must not
  // change on every render or they would loop.
  const setSpec = useCallback((next: HeaderSpec | null) => {
    setSpecState(next);
  }, []);

  const value = useMemo(() => ({ spec, setSpec }), [spec, setSpec]);

  return (
    <HeaderContext.Provider value={value}>{children}</HeaderContext.Provider>
  );
}

/**
 * Publish a header spec from a page.
 *
 * MUST run in useLayoutEffect (not useEffect): the spec has to be set before
 * the browser paints, otherwise the title visibly flashes empty on every
 * navigation. Dependencies are serialised so a fresh object literal on each
 * render does not re-publish infinitely.
 */
export function useSetHeader(spec: HeaderSpec | null) {
  const ctx = useContext(HeaderContext);
  const setSpec = ctx?.setSpec;
  const key = useMemo(() => JSON.stringify(spec), [spec]);

  useLayoutEffect(() => {
    if (!setSpec) return;
    setSpec(spec);
    return () => setSpec(null);
    // `spec` is re-created every render; `key` is its stable fingerprint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setSpec]);
}

export function useHeader() {
  const ctx = useContext(HeaderContext);
  if (!ctx) throw new Error("useHeader must be used inside <HeaderProvider>");
  return ctx;
}
