/** Where on the storage bucket ticket files live. */
export const ATTACHMENT_BUCKET = "ticket-attachments";

/** 10 MB — mirrors the bucket's `file_size_limit`. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** How many files a single complaint may carry. */
export const MAX_ATTACHMENTS = 10;

export const ACCEPTED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
];

export function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Object key layout:  <ticketId>/<timestamp>-<random>.<ext>
 *
 * The first path segment is the ticket id, which is exactly what the storage
 * RLS policies check via `(storage.foldername(name))[1]`.
 */
export function buildObjectPath(ticketId: string, file: File): string {
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${ticketId}/${unique}.${ext || "bin"}`;
}
