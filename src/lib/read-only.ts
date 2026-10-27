/*
 * Preview deployments read the real leads but can never write to them.
 * Vercel sets VERCEL_ENV=preview on every branch deployment, so this holds
 * even if a preview is given the production database keys. READ_ONLY=1 forces
 * it anywhere else (for example a local run against production).
 */
export function isReadOnly(): boolean {
  return process.env.VERCEL_ENV === "preview" || process.env.READ_ONLY === "1";
}

export class ReadOnlyError extends Error {
  constructor() {
    super("This is a read-only preview. Nothing was saved.");
  }
}
