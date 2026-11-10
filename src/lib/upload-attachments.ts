"use client";

import { createClient } from "@/lib/supabase/client";
import {
  ACCEPTED_MIME,
  ATTACHMENT_BUCKET,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  buildObjectPath,
  formatBytes,
} from "@/lib/storage";
import type { Attachment } from "@/lib/types/database";

type UploadCandidate = { file: File };

/**
 * Push files into the private ticket bucket and return the manifest that is
 * stored on the ticket or message. The object key always starts with the
 * ticket id, which is what the storage RLS policies check.
 */
export async function uploadAttachments(
  ticketId: string,
  files: UploadCandidate[],
): Promise<Attachment[]> {
  if (files.length === 0) return [];
  if (files.length > MAX_ATTACHMENTS) {
    throw new Error(`Maksimal ${MAX_ATTACHMENTS} lampiran per pesan.`);
  }

  const supabase = createClient();
  const uploaded: Attachment[] = [];

  for (const { file } of files) {
    if (!ACCEPTED_MIME.includes(file.type)) {
      throw new Error(`"${file.name}" bukan gambar/PDF yang didukung.`);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `"${file.name}" lebih dari ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
      );
    }

    const path = buildObjectPath(ticketId, file);
    const { error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(path, file, {
        contentType: file.type,
        upsert: false,
      });

    if (error) {
      throw new Error(`Gagal mengunggah "${file.name}": ${error.message}`);
    }

    uploaded.push({
      path,
      name: file.name,
      mime: file.type,
      size: file.size,
    });
  }

  return uploaded;
}
