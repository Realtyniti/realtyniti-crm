import { normalisePhone } from "../phone";
import type { Store } from "../store/types";
import { hashPassword, hashToken, newToken, passwordProblem, sameSecret, verifyPassword } from "./password";
import { isRole } from "./roles";
import { DuplicateError, toMember, type AuthStore, type Member, type MemberRow } from "./store";

/*
 * Team logins: first-time owner setup, sign-in, invite links, deactivation.
 * Plain functions over the stores so tests can run them without Next.js.
 */

export class AuthError extends Error {}

export const SESSION_DAYS = 30;
export const INVITE_DAYS = 7;
/** Wrong passwords in a row before the login is paused, and for how long. */
export const MAX_FAILED = 5;
export const LOCK_MINUTES = 15;
/** How often a session's "last seen" is written (and its expiry pushed back). */
const TOUCH_EVERY_MS = 60 * 60_000;

const days = (n: number, from = new Date()) => new Date(from.getTime() + n * 24 * 3600_000).toISOString();

function cleanName(name: string | null | undefined): string {
  const n = (name ?? "").replace(/\s+/g, " ").trim();
  if (!n) throw new AuthError("Enter a name.");
  if (n.length > 80) throw new AuthError("That name is too long.");
  return n;
}

function cleanPhone(phone: string | null | undefined): string {
  const p = normalisePhone(phone);
  if (!p) throw new AuthError("Enter a valid mobile number.");
  return p;
}

function checkPassword(password: string, confirm?: string) {
  const problem = passwordProblem(password);
  if (problem) throw new AuthError(problem);
  if (confirm !== undefined && confirm !== password) throw new AuthError("The two passwords don't match.");
}

async function startSession(auth: AuthStore, memberId: string, userAgent: string | null, now = new Date()) {
  const token = newToken();
  await auth.insertSession({ token_hash: hashToken(token), member_id: memberId, user_agent: userAgent?.slice(0, 300) ?? null, expires_at: days(SESSION_DAYS, now) });
  return token;
}

/**
 * First-time setup: creates the owner login, once. Needs the CRM's current shared password
 * (ADMIN_PASSWORD), so only someone who could already open the CRM can claim it.
 * Without ADMIN_PASSWORD it is allowed only outside production (local demo).
 */
export async function setupOwner(
  auth: AuthStore,
  input: { name: string; phone: string; password: string; confirm: string; setupKey: string; userAgent?: string | null },
  env: { adminPassword?: string; production: boolean },
): Promise<{ member: Member; token: string }> {
  if ((await auth.countMembers()) > 0) throw new AuthError("The owner login is already set up. Sign in instead.");
  if (env.adminPassword) {
    if (!sameSecret(input.setupKey, env.adminPassword)) throw new AuthError("The current CRM password is not right.");
  } else if (env.production) {
    throw new AuthError("Setup is closed: ADMIN_PASSWORD is not set on the server.");
  }
  const name = cleanName(input.name);
  const phone = cleanPhone(input.phone);
  checkPassword(input.password, input.confirm);
  let row: MemberRow;
  try {
    row = await auth.insertMember({ name, phone, role: "owner", password_hash: await hashPassword(input.password) });
  } catch (e) {
    if (e instanceof DuplicateError) throw new AuthError("The owner login is already set up. Sign in instead.");
    throw e;
  }
  await auth.updateMember(row.id, { last_login_at: new Date().toISOString() });
  return { member: toMember(row), token: await startSession(auth, row.id, input.userAgent ?? null) };
}

const WRONG = "That mobile number and password don't match.";

/** Sign in with mobile number and password. Five wrong tries in a row pause the login for 15 minutes. */
export async function signIn(
  auth: AuthStore,
  input: { phone: string; password: string; userAgent?: string | null },
  now = new Date(),
): Promise<{ member: Member; token: string }> {
  const phone = normalisePhone(input.phone);
  const row = phone ? await auth.findMemberByPhone(phone) : null;
  if (!row || !row.password_hash) {
    // Same work as a real check, so the answer time doesn't reveal which numbers are on the team.
    await verifyPassword(input.password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==");
    throw new AuthError(WRONG);
  }
  if (row.locked_until && row.locked_until > now.toISOString()) {
    throw new AuthError(`Too many wrong tries. Try again after ${LOCK_MINUTES} minutes, or ask the owner to send a new link.`);
  }
  const ok = await verifyPassword(input.password, row.password_hash);
  if (!ok) {
    const failed = row.failed_logins + 1;
    await auth.updateMember(row.id, {
      failed_logins: failed >= MAX_FAILED ? 0 : failed,
      locked_until: failed >= MAX_FAILED ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : row.locked_until,
    });
    throw new AuthError(WRONG);
  }
  if (!row.active) throw new AuthError("This login has been switched off. Ask the owner if that's a mistake.");
  await auth.updateMember(row.id, { failed_logins: 0, locked_until: null, last_login_at: now.toISOString() });
  return { member: toMember(row), token: await startSession(auth, row.id, input.userAgent ?? null, now) };
}

/** The signed-in member for a cookie token, or null. A deactivated member or expired session is null. */
export async function resolveSession(auth: AuthStore, token: string | null | undefined, now = new Date()): Promise<Member | null> {
  if (!token || token.length > 200) return null;
  const session = await auth.findSession(hashToken(token));
  if (!session || session.expires_at <= now.toISOString()) return null;
  const row = await auth.getMember(session.member_id);
  if (!row || !row.active) return null;
  if (now.getTime() - new Date(session.last_seen_at).getTime() > TOUCH_EVERY_MS) {
    await auth.touchSession(session.id, { last_seen_at: now.toISOString(), expires_at: days(SESSION_DAYS, now) });
  }
  return toMember(row);
}

export async function signOut(auth: AuthStore, token: string | null | undefined) {
  if (token) await auth.deleteSession(hashToken(token));
}

/** A fresh one-time link for setting a password. Older links for the same person stop working. */
export async function issueInvite(auth: AuthStore, memberId: string, now = new Date()): Promise<string> {
  await auth.deleteMemberInvites(memberId);
  const token = newToken();
  await auth.insertInvite({ token_hash: hashToken(token), member_id: memberId, expires_at: days(INVITE_DAYS, now) });
  return token;
}

/** Owner adds a manager or agent. Returns the one-time link token to send them. */
export async function addMember(
  auth: AuthStore,
  actor: Member,
  input: { name: string; phone: string; role: string },
): Promise<{ member: Member; token: string }> {
  if (actor.role !== "owner") throw new AuthError("Only the owner can add people.");
  if (!isRole(input.role) || input.role === "owner") throw new AuthError("Pick Manager or Agent.");
  const name = cleanName(input.name);
  const phone = cleanPhone(input.phone);
  let row: MemberRow;
  try {
    row = await auth.insertMember({ name, phone, role: input.role });
  } catch (e) {
    if (e instanceof DuplicateError) throw new AuthError(e.message);
    throw e;
  }
  return { member: toMember(row), token: await issueInvite(auth, row.id) };
}

/** Who an invite link is for, if it can still be used. */
export async function inviteFor(auth: AuthStore, token: string, now = new Date()): Promise<Member | null> {
  if (!token || token.length > 200) return null;
  const invite = await auth.findInvite(hashToken(token));
  if (!invite || invite.used_at || invite.expires_at <= now.toISOString()) return null;
  const row = await auth.getMember(invite.member_id);
  return row && row.active ? toMember(row) : null;
}

/**
 * The member sets their password from their link and is signed in. Every other device they
 * were signed in on is signed out (this is also how a password reset works).
 */
export async function acceptInvite(
  auth: AuthStore,
  input: { token: string; password: string; confirm: string; userAgent?: string | null },
  now = new Date(),
): Promise<{ member: Member; token: string }> {
  const member = await inviteFor(auth, input.token, now);
  if (!member) throw new AuthError("This link has expired or was already used. Ask the owner for a new one.");
  checkPassword(input.password, input.confirm);
  const hash = await hashPassword(input.password);
  if (!(await auth.useInvite(hashToken(input.token), now.toISOString()))) {
    throw new AuthError("This link was already used. Ask the owner for a new one.");
  }
  await auth.deleteMemberSessions(member.id);
  const row = await auth.updateMember(member.id, { password_hash: hash, failed_logins: 0, locked_until: null, last_login_at: now.toISOString() });
  return { member: toMember(row), token: await startSession(auth, member.id, input.userAgent ?? null, now) };
}

/** Signed-in member changes their own password; their other devices are signed out. */
export async function changePassword(
  auth: AuthStore,
  member: Member,
  input: { current: string; password: string; confirm: string; userAgent?: string | null },
): Promise<string> {
  const row = await auth.getMember(member.id);
  if (!row || !(await verifyPassword(input.current, row.password_hash))) throw new AuthError("Your current password is not right.");
  checkPassword(input.password, input.confirm);
  await auth.updateMember(member.id, { password_hash: await hashPassword(input.password) });
  await auth.deleteMemberSessions(member.id);
  return startSession(auth, member.id, input.userAgent ?? null);
}

async function editable(auth: AuthStore, actor: Member, memberId: string): Promise<MemberRow> {
  if (actor.role !== "owner") throw new AuthError("Only the owner can change the team.");
  const row = await auth.getMember(memberId);
  if (!row) throw new AuthError("That person is not on the team.");
  if (row.role === "owner") throw new AuthError("The owner login can't be changed here.");
  return row;
}

/**
 * One tap: the login stops working on every device straight away (all sessions, links and alert
 * subscriptions are deleted), and their leads stay assigned to them until someone reassigns them.
 */
export async function deactivateMember(auth: AuthStore, actor: Member, memberId: string, now = new Date()) {
  const row = await editable(auth, actor, memberId);
  await auth.updateMember(row.id, { active: false, deactivated_at: now.toISOString() });
  const devices = await auth.deleteMemberSessions(row.id);
  await auth.deleteMemberInvites(row.id);
  await auth.deleteMemberPush(row.id);
  return { member: toMember({ ...row, active: false, deactivated_at: now.toISOString() }), devices };
}

/** Lets a deactivated person sign in again with their old password. */
export async function reactivateMember(auth: AuthStore, actor: Member, memberId: string) {
  const row = await editable(auth, actor, memberId);
  return toMember(await auth.updateMember(row.id, { active: true, deactivated_at: null, failed_logins: 0, locked_until: null }));
}

export async function changeRole(auth: AuthStore, actor: Member, memberId: string, role: string) {
  const row = await editable(auth, actor, memberId);
  if (!isRole(role) || role === "owner") throw new AuthError("Pick Manager or Agent.");
  return toMember(await auth.updateMember(row.id, { role }));
}

/** New password link for someone; their current devices are signed out now. */
export async function resetMember(auth: AuthStore, actor: Member, memberId: string) {
  const row = await editable(auth, actor, memberId);
  if (!row.active) throw new AuthError("Reactivate this person first.");
  await auth.deleteMemberSessions(row.id);
  return issueInvite(auth, row.id);
}

/** Hands every lead of one member to another active member (or leaves them unassigned). */
export async function reassignAll(auth: AuthStore, store: Store, actor: Member, fromId: string, toId: string | null) {
  if (actor.role !== "owner" && actor.role !== "manager") throw new AuthError("Only the owner or a manager can reassign leads.");
  if (toId) {
    const to = await auth.getMember(toId);
    if (!to || !to.active) throw new AuthError("Pick someone who is active on the team.");
    if (toId === fromId) throw new AuthError("Pick someone else.");
  }
  return store.reassignLeads(fromId, toId);
}
