import { describe, expect, it, afterEach } from "vitest";
import webpush from "web-push";
import { deriveVapidKeys, vapidPublicKey } from "@/lib/push";

describe("VAPID keys derived from the server secret", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("gives the same valid key pair for the same secret, and a different one for another", () => {
    const a = deriveVapidKeys("secret-one");
    expect(deriveVapidKeys("secret-one")).toEqual(a);
    expect(deriveVapidKeys("secret-two").publicKey).not.toBe(a.publicKey);
    expect(Buffer.from(a.publicKey, "base64url")).toHaveLength(65);
    expect(Buffer.from(a.privateKey, "base64url")).toHaveLength(32);
    // web-push validates both keys.
    expect(() => webpush.setVapidDetails("https://tathyahomes.com", a.publicKey, a.privateKey)).not.toThrow();
  });

  it("prefers explicit VAPID env keys, falls back to the derived pair, and is off with neither", () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(vapidPublicKey()).toBeNull();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    expect(vapidPublicKey()).toBe(deriveVapidKeys("service-key").publicKey);
    const explicit = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = explicit.publicKey;
    process.env.VAPID_PRIVATE_KEY = explicit.privateKey;
    expect(vapidPublicKey()).toBe(explicit.publicKey);
  });
});
