/** Shared username rules for the server actions and the client forms. */
export const USERNAME_PATTERN = "^[a-z0-9][a-z0-9._-]{2,31}$";
export const USERNAME_REGEX = new RegExp(USERNAME_PATTERN);
export const USERNAME_HINT =
  "3–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip.";

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Suggest a handle from a full name: "Bang Ridho" -> "bang.ridho".
 * Only a convenience; the user can edit the result.
 */
export function suggestUsername(fullName: string): string {
  const base = fullName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 32);

  return USERNAME_REGEX.test(base) ? base : "";
}
