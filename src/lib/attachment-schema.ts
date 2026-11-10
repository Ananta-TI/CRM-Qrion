import { z } from "zod";

import {
  ACCEPTED_MIME,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/storage";

/**
 * The manifest a browser sends after it has uploaded the bytes. The bucket
 * enforces the real limits; this keeps malformed rows out of the database.
 */
export const attachmentSchema = z.object({
  path: z.string().min(1).max(512),
  name: z.string().min(1).max(256),
  mime: z
    .string()
    .min(1)
    .max(128)
    .refine((mime) => ACCEPTED_MIME.includes(mime), "Tipe file tidak didukung."),
  size: z.number().nonnegative().max(MAX_ATTACHMENT_BYTES),
});

export const attachmentsSchema = z
  .array(attachmentSchema)
  .max(MAX_ATTACHMENTS);
