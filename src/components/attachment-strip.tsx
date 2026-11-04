"use client";

import { useState } from "react";

import { IconClose, IconImage, IconDownload } from "@/components/icons";
import type { SignedAttachment } from "@/lib/attachments";
import { isImage } from "@/lib/storage";

/**
 * Renders the files attached to a ticket or message. Images open in a lightbox;
 * PDFs and anything else open in a new tab. If a signed URL could not be
 * minted the item still shows, greyed out, so the record is never lost.
 */
export function AttachmentStrip({
  items,
}: {
  items: SignedAttachment[];
}) {
  const [open, setOpen] = useState<SignedAttachment | null>(null);

  if (items.length === 0) return null;

  return (
    <>
      <div className="attach-strip">
        {items.map((a) =>
          a.url ? (
            isImage(a.mime) ? (
              <button
                key={a.path}
                type="button"
                className="attach-strip__item"
                onClick={() => setOpen(a)}
                title={`${a.name} — buka`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url} alt={a.name} className="attach-strip__img" />
              </button>
            ) : (
              <a
                key={a.path}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="attach-strip__item"
                title={a.name}
              >
                <span className="attach-strip__file">
                  <IconDownload />
                  <span className="attach-strip__name">{a.name}</span>
                </span>
              </a>
            )
          ) : (
            <span
              key={a.path}
              className="attach-strip__item"
              title={`${a.name} — tidak tersedia`}
            >
              <span className="attach-strip__file" style={{ opacity: 0.45 }}>
                <IconImage />
                <span className="attach-strip__name">{a.name}</span>
              </span>
            </span>
          ),
        )}
      </div>

      {open?.url && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={open.name}
          onClick={() => setOpen(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={open.url} alt={open.name} className="lightbox__img" />
          <button
            type="button"
            className="lightbox__close"
            onClick={() => setOpen(null)}
            aria-label="Tutup"
          >
            <IconClose />
          </button>
        </div>
      )}
    </>
  );
}
