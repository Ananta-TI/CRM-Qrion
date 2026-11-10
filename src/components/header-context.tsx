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

  // Never stringify `actions`: on ticket detail pages it is a React element
  // tree that contains the whole conversation transcript. Serialising that on
  // every render is expensive and added real work to every header update.
  // Title/sub/crumbs are enough to detect content changes; actions are compared
  // by identity instead.
  const key = useMemo(
    () =>
      JSON.stringify({
        title: spec?.title,
        sub: spec?.sub,
        crumbs: spec?.crumbs,
      }),
    [spec?.title, spec?.sub, spec?.crumbs],
  );

  useLayoutEffect(() => {
    if (!setSpec) return;
    setSpec(spec);
    // Deliberately no `setSpec(null)` cleanup. The shell keeps the previous
    // title while the next page streams in; clearing it made the header flash
    // a skeleton bar on every navigation, and the document shifted as the
    // placeholder height differed from the real title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, spec?.actions, setSpec]);
}

export function useHeader() {
  const ctx = useContext(HeaderContext);
  if (!ctx) throw new Error("useHeader must be used inside <HeaderProvider>");
  return ctx;
}
