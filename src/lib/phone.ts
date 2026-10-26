/**
 * Normalise an Indian mobile number to +91XXXXXXXXXX so the same client
 * arriving from WhatsApp and a Meta form matches one card.
 * Returns null when the input cannot be a valid number.
 */
export function normalisePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  let digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+") && !digits.startsWith("91")) {
    // Foreign number (NRI buyers): keep as given, if plausible.
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.startsWith("0091")) digits = digits.slice(4);
  else if (digits.length === 13 && digits.startsWith("091")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}
