import "server-only";

import { createClient } from "@/lib/supabase/server";
import { ATTACHMENT_BUCKET } from "@/lib/storage";
import type { Attachment } from "@/lib/types/database";

/**
 * A file plus a short-lived signed URL to read it.
 * Bucket is private, so the URL is what makes it viewable.
 */
export type SignedAttachment = Attachment & { url: string | null };

/**
 * Mints signed URLs for a batch of attachments.
 *
 * `createSignedUrls` does the whole batch in one round trip. Anything that
 * fails (deleted object, revoked access) comes back with `url: null` rather
 * than blowing up the page.
 */
export async function signAttachments(
  items: Attachment[] | null | undefined,
  expiresIn = 60 * 60,
): Promise<SignedAttachment[]> {
  const list = (items ?? []).filter(Boolean);
  if (list.length === 0) return [];

  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrls(
      list.map((a) => a.path),
      expiresIn,
    );

  if (error || !data) {
    return list.map((a) => ({ ...a, url: null }));
  }

  const urlByPath = new Map(
    data.map((d) => [d.path, d.signedUrl ?? null] as const),
  );

  return list.map((a) => ({ ...a, url: urlByPath.get(a.path) ?? null }));
}
