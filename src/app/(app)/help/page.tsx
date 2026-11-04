import { redirect } from "next/navigation";

export const metadata = { title: "Bantuan" };

/**
 * Help was merged into the Knowledge Base: one place for articles, FAQ,
 * status flow and the SLA table. The route stays as a redirect so old links
 * and bookmarks keep working.
 */
export default function HelpPage() {
  redirect("/knowledge");
}
