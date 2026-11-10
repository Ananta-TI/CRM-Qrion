import Link from "next/link";

import { IconLeft, IconRight } from "@/components/icons";

/**
 * Tiny server-rendered pager. Query params are preserved, so searching and
 * filtering survive page changes without any client state.
 */
export function Pager({
  page,
  pageCount,
  basePath,
  params,
}: {
  page: number;
  pageCount: number;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) return null;

  const href = (target: number) => {
    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(params ?? {})) {
      if (value && key !== "page") search.set(key, value);
    }
    if (target > 1) search.set("page", String(target));

    const qs = search.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const prev = Math.max(1, page - 1);
  const next = Math.min(pageCount, page + 1);

  return (
    <nav className="pager" aria-label="Halaman">
      {page > 1 ? (
        <Link className="pager__btn" href={href(prev)} rel="prev" prefetch={false}>
          <IconLeft /> Sebelumnya
        </Link>
      ) : (
        <span className="pager__btn pager__btn--off" aria-disabled="true">
          <IconLeft /> Sebelumnya
        </span>
      )}

      <span className="pager__meta">
        Halaman <b>{page}</b> dari <b>{pageCount}</b>
      </span>

      {page < pageCount ? (
        <Link className="pager__btn" href={href(next)} rel="next" prefetch={false}>
          Berikutnya <IconRight />
        </Link>
      ) : (
        <span className="pager__btn pager__btn--off" aria-disabled="true">
          Berikutnya <IconRight />
        </span>
      )}
    </nav>
  );
}
