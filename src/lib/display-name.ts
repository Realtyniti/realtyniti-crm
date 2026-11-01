export interface DisplayName {
  /** What the CRM shows. */
  name: string;
  /** The name as Meta sent it, when it had to be tidied (handles, decorative fonts, symbols). */
  raw: string | null;
  /** True when the name probably isn't the buyer's real name and should be confirmed on a call. */
  check: boolean;
}

/**
 * Meta lead forms prefill the buyer's Instagram or Facebook profile name, so some arrive as
 * handles ("nikhil7060"), decorative Unicode ("Ⓐⓩⓘⓜ"), ALL CAPS or all lowercase. This only
 * changes what the screen shows; the stored name, and every message sent to the buyer, stay as they are.
 */
export function displayName(raw: string | null | undefined): DisplayName {
  if (!raw?.trim()) return { name: "Unnamed lead", raw: null, check: true };
  let s = raw.normalize("NFKC");
  const decorated = s !== raw.normalize("NFC");
  const junk = /[0-9_@#]/.test(s) || /[^\p{L}\p{M}\s.'-]/u.test(s);
  s = s.replace(/[^\p{L}\p{M}\s.'-]/gu, " ").replace(/\s+/g, " ").trim();
  const parts = s.split(" ");
  // "F I R O J" → "FIROJ"
  if (parts.length >= 3 && parts.every((p) => [...p].length === 1)) s = parts.join("");
  const words = s
    .split(" ")
    .filter(Boolean)
    .map((w) => (/^[A-Za-z.'-]+$/.test(w) && (w === w.toLowerCase() || w === w.toUpperCase()) ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w));
  const name = words.filter((w, i) => i === 0 || w.toLowerCase() !== words[i - 1]!.toLowerCase()).join(" ");
  const check = decorated || junk || !name;
  return { name: name || "Unnamed lead", raw: check ? raw : null, check };
}
