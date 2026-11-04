"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { IconImage, IconTrash, IconUpload } from "@/components/icons";
import {
  ACCEPTED_MIME,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  formatBytes,
  isImage,
} from "@/lib/storage";

/**
 * A pending file that has been picked but not yet uploaded.
 * `previewUrl` is an object URL, revoked when the file leaves the list.
 */
export type PendingFile = {
  id: string;
  file: File;
  previewUrl: string | null;
};

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * The "attach anything" control: click to browse, drag files in, or paste an
 * image straight from the clipboard. Mirrors what people expect from an email
 * client. It only collects files; the caller uploads them.
 */
export function AttachmentDrop({
  files,
  onChange,
  disabled,
}: {
  files: PendingFile[];
  onChange: (next: PendingFile[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref so the paste listener reads the latest list without
  // re-subscribing on every keystroke elsewhere in the form.
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const accept = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;

      const current = filesRef.current;
      const room = MAX_ATTACHMENTS - current.length;
      if (room <= 0) {
        setError(`Maksimal ${MAX_ATTACHMENTS} lampiran.`);
        return;
      }

      const accepted: PendingFile[] = [];
      let rejection: string | null = null;

      for (const file of incoming.slice(0, room)) {
        if (!ACCEPTED_MIME.includes(file.type)) {
          rejection = `"${file.name}" bukan gambar/PDF yang didukung.`;
          continue;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          rejection = `"${file.name}" lebih dari ${formatBytes(MAX_ATTACHMENT_BYTES)}.`;
          continue;
        }
        accepted.push({
          id: newId(),
          file,
          previewUrl: isImage(file.type) ? URL.createObjectURL(file) : null,
        });
      }

      if (incoming.length > room) {
        rejection = `Hanya ${room} file pertama yang ditambahkan (batas ${MAX_ATTACHMENTS}).`;
      }

      setError(rejection);
      if (accepted.length > 0) onChange([...current, ...accepted]);
    },
    [onChange],
  );

  // Paste anywhere on the page while this control is mounted.
  useEffect(() => {
    if (disabled) return;

    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pasted: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) pasted.push(file);
        }
      }
      if (pasted.length > 0) {
        e.preventDefault();
        accept(pasted);
      }
    }

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [accept, disabled]);

  function remove(id: string) {
    const target = filesRef.current.find((f) => f.id === id);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    onChange(filesRef.current.filter((f) => f.id !== id));
  }

  return (
    <div className="attach">
      <div
        className={`attach__drop${dragging ? " attach__drop--over" : ""}${
          disabled ? " attach__drop--off" : ""
        }`}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(false);
          accept(Array.from(e.dataTransfer.files));
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <IconUpload />
        <div>
          <p className="attach__title">
            Tarik gambar ke sini, tempel dari clipboard, atau klik untuk memilih
          </p>
          <p className="attach__hint">
            PNG, JPG, WEBP, GIF, atau PDF · maks {formatBytes(MAX_ATTACHMENT_BYTES)} ·
            sampai {MAX_ATTACHMENTS} file
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_MIME.join(",")}
          hidden
          disabled={disabled}
          onChange={(e) => {
            accept(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {error && <p className="form-note form-note--err mt-2">{error}</p>}

      {files.length > 0 && (
        <ul className="attach__list">
          {files.map((f) => (
            <li key={f.id} className="attach__item">
              {f.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.previewUrl} alt={f.file.name} className="attach__thumb" />
              ) : (
                <span className="attach__thumb attach__thumb--file">
                  <IconImage />
                </span>
              )}
              <div className="attach__meta">
                <span className="attach__name">{f.file.name}</span>
                <span className="attach__size">{formatBytes(f.file.size)}</span>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--xs"
                onClick={() => remove(f.id)}
                disabled={disabled}
                aria-label={`Hapus ${f.file.name}`}
              >
                <IconTrash />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
