import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, isViewOnly, type Permission, type Role } from "./roles";
import { MemoryAuthStore, SupabaseAuthStore, type AuthStore, type Member } from "./store";
import { resolveSession, SESSION_DAYS } from "./team";

export const SESSION_COOKIE = "rn_session";

const globalForAuth = globalThis as unknown as { __realtynitiAuth?: AuthStore };

/**
 * Logins live in Supabase when it is configured, otherwise in memory (local demo).
 * Unlike the lead store this is never read-only, so people can sign in to a preview;
 * the screens that change the team refuse in previews themselves.
 */
export function getAuthStore(): AuthStore {
  if (!globalForAuth.__realtynitiAuth) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    globalForAuth.__realtynitiAuth = url && key ? new SupabaseAuthStore(url, key) : new MemoryAuthStore();
  }
  return globalForAuth.__realtynitiAuth;
}

/** The signed-in member for this request (checked against the database once per request), or null. */
export const currentMember = cache(async (): Promise<Member | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSession(getAuthStore(), token);
});

/** For pages: the member, or off to the sign-in screen. */
export async function requireMember(): Promise<Member> {
  const member = await currentMember();
  if (!member) redirect("/login");
  return member;
}

/** For pages: the member if their role allows this, otherwise back to the dashboard. */
export async function requirePermission(permission: Permission): Promise<Member> {
  const member = await requireMember();
  if (!can(member.role, permission)) redirect("/?denied=1");
  return member;
}

export class PermissionError extends Error {
  constructor(message = "You don't have access to that.") {
    super(message);
  }
}

/** For server actions: the member, or an error (never a redirect, so forms can show it). */
export async function actor(permission?: Permission): Promise<Member> {
  const member = await currentMember();
  if (!member) throw new PermissionError("You have been signed out. Sign in again.");
  // Every server action goes through here: a view-only login can never change anything.
  if (isViewOnly(member.role)) throw new PermissionError("This is a view-only reviewer login. Nothing can be changed.");
  if (permission && !can(member.role, permission)) throw new PermissionError();
  return member;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

/** The people a lead can show as assigned to. Agents get only themselves; the owner and managers get everyone. */
export async function teamOptions(me: Member): Promise<{ id: string; name: string; role: Role; active: boolean }[]> {
  if (!can(me.role, "leads.assign")) return [{ id: me.id, name: me.name, role: me.role, active: true }];
  return (await getAuthStore().listMembers()).map((m) => ({ id: m.id, name: m.name, role: m.role, active: m.active }));
}
