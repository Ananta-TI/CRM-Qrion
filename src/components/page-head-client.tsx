"use client";

import { useSetHeader } from "@/components/header-context";

/**
 * Bridges a Server Component page to the persistent header. Renders nothing
 * itself: it publishes the spec and the shell paints it into the single
 * <header class="phead"> element that never unmounts.
 */
export function PageHeadClient({
  title,
  sub,
  crumbs,
  actions,
}: {
  title: string;
  sub?: string;
  crumbs?: { label: string; href?: string }[];
  actions?: React.ReactNode;
}) {
  useSetHeader({ title, sub, crumbs, actions });
  return null;
}
