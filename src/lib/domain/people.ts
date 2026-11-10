/**
 * Names in this workspace are written the way people address each other:
 * "Bang Ridho", "Kak Dila". Greeting someone with the first word alone
 * produced "Halo, Kak" / "Selamat datang, Bang", so the honourific is dropped
 * and the actual given name is used instead.
 */
const HONORIFICS = new Set([
  "bang",
  "kak",
  "pak",
  "bu",
  "bapak",
  "ibu",
  "mas",
  "mbak",
  "mba",
  "kang",
  "teh",
  "mr",
  "mrs",
  "ms",
  "dr",
  "drs",
  "prof",
  "h",
]);

/** The name to put after "Halo," / "Selamat datang,". */
export function greetingName(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Anda";

  const [first, second] = parts;
  if (second && HONORIFICS.has(first.toLowerCase().replace(/[.,]/g, ""))) {
    return second;
  }

  return first;
}