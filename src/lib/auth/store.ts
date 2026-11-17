import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "./roles";

/** A team member as the screens see them: never the password hash. */
export interface Member {
  id: string;
  name: string;
  phone: string;
  role: Role;
  active: boolean;
  has_password: boolean;
  last_login_at: string | null;
  deactivated_at: string | null;
  created_at: string;
}

/** The stored row, with what sign-in needs. Server-only. */
export interface MemberRow extends Omit<Member, "has_password"> {
  password_hash: string | null;
  failed_logins: number;
  locked_until: string | null;
  updated_at: string;
}

export type MemberPatch = Partial<Pick<MemberRow, "name" | "role" | "password_hash" | "active" | "failed_logins" | "locked_until" | "last_login_at" | "deactivated_at">>;

export interface Session {
  id: string;
  token_hash: string;
  member_id: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export interface Invite {
  token_hash: string;
  member_id: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface PushSubscriptionRow {
  id: string;
  member_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
}

export class DuplicateError extends Error {}

/** Storage for logins, kept apart from the lead Store so previews (read-only for leads) can still sign people in. */
export interface AuthStore {
  countMembers(): Promise<number>;
  listMembers(): Promise<Member[]>;
  getMember(id: string): Promise<MemberRow | null>;
  findMemberByPhone(phone: string): Promise<MemberRow | null>;
  /** Throws DuplicateError when the phone is taken, or when a second owner is added. */
  insertMember(m: { name: string; phone: string; role: Role; password_hash?: string | null }): Promise<MemberRow>;
  updateMember(id: string, patch: MemberPatch): Promise<MemberRow>;

  insertSession(s: Omit<Session, "id" | "created_at" | "last_seen_at">): Promise<Session>;
  findSession(tokenHash: string): Promise<Session | null>;
  touchSession(id: string, patch: Pick<Session, "last_seen_at" | "expires_at">): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteMemberSessions(memberId: string): Promise<number>;
  /** Signed-in devices per member. */
  countSessions(): Promise<Record<string, number>>;

  insertInvite(i: Omit<Invite, "created_at" | "used_at">): Promise<Invite>;
  findInvite(tokenHash: string): Promise<Invite | null>;
  /** Marks the invite used if it was still unused, atomically. False when someone used it first. */
  useInvite(tokenHash: string, at: string): Promise<boolean>;
  deleteMemberInvites(memberId: string): Promise<void>;

  upsertPush(p: Omit<PushSubscriptionRow, "id" | "created_at">): Promise<void>;
  listPush(memberIds: string[]): Promise<PushSubscriptionRow[]>;
  deletePush(endpoint: string): Promise<void>;
  deleteMemberPush(memberId: string): Promise<void>;
}

export function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    role: row.role,
    active: row.active,
    has_password: !!row.password_hash,
    last_login_at: row.last_login_at,
    deactivated_at: row.deactivated_at,
    created_at: row.created_at,
  };
}

const ROLE_ORDER: Record<Role, number> = { owner: 0, manager: 1, agent: 2, reviewer: 3 };
const byRoleThenName = (a: Member, b: Member) =>
  Number(b.active) - Number(a.active) || ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name);

/** In-process auth storage for local demo and tests. */
export class MemoryAuthStore implements AuthStore {
  members = new Map<string, MemberRow>();
  sessions = new Map<string, Session>();
  invites = new Map<string, Invite>();
  push = new Map<string, PushSubscriptionRow>();

  async countMembers() {
    return this.members.size;
  }
  async listMembers() {
    return [...this.members.values()].map(toMember).sort(byRoleThenName);
  }
  async getMember(id: string) {
    return this.members.get(id) ?? null;
  }
  async findMemberByPhone(phone: string) {
    return [...this.members.values()].find((m) => m.phone === phone) ?? null;
  }
  async insertMember(m: { name: string; phone: string; role: Role; password_hash?: string | null }) {
    if (await this.findMemberByPhone(m.phone)) throw new DuplicateError("That mobile number is already on the team.");
    if (m.role === "owner" && [...this.members.values()].some((x) => x.role === "owner")) throw new DuplicateError("The CRM already has an owner.");
    const now = new Date().toISOString();
    const row: MemberRow = {
      id: randomUUID(),
      name: m.name,
      phone: m.phone,
      role: m.role,
      password_hash: m.password_hash ?? null,
      active: true,
      failed_logins: 0,
      locked_until: null,
      last_login_at: null,
      deactivated_at: null,
      created_at: now,
      updated_at: now,
    };
    this.members.set(row.id, row);
    return row;
  }
  async updateMember(id: string, patch: MemberPatch) {
    const row = this.members.get(id);
    if (!row) throw new Error("No such member");
    if (patch.role === "owner" && row.role !== "owner") throw new DuplicateError("The CRM already has an owner.");
    const next = { ...row, ...patch, updated_at: new Date().toISOString() };
    this.members.set(id, next);
    return next;
  }

  async insertSession(s: Omit<Session, "id" | "created_at" | "last_seen_at">) {
    const now = new Date().toISOString();
    const row: Session = { ...s, id: randomUUID(), created_at: now, last_seen_at: now };
    this.sessions.set(row.token_hash, row);
    return row;
  }
  async findSession(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }
  async touchSession(id: string, patch: Pick<Session, "last_seen_at" | "expires_at">) {
    for (const [k, s] of this.sessions) if (s.id === id) this.sessions.set(k, { ...s, ...patch });
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
  async deleteMemberSessions(memberId: string) {
    let n = 0;
    for (const [k, s] of this.sessions) {
      if (s.member_id === memberId) {
        this.sessions.delete(k);
        n++;
      }
    }
    return n;
  }
  async countSessions() {
    const out: Record<string, number> = {};
    const now = new Date().toISOString();
    for (const s of this.sessions.values()) if (s.expires_at > now) out[s.member_id] = (out[s.member_id] ?? 0) + 1;
    return out;
  }

  async insertInvite(i: Omit<Invite, "created_at" | "used_at">) {
    const row: Invite = { ...i, created_at: new Date().toISOString(), used_at: null };
    this.invites.set(i.token_hash, row);
    return row;
  }
  async findInvite(tokenHash: string) {
    return this.invites.get(tokenHash) ?? null;
  }
  async useInvite(tokenHash: string, at: string) {
    const i = this.invites.get(tokenHash);
    if (!i || i.used_at) return false;
    this.invites.set(tokenHash, { ...i, used_at: at });
    return true;
  }
  async deleteMemberInvites(memberId: string) {
    for (const [k, i] of this.invites) if (i.member_id === memberId) this.invites.delete(k);
  }

  async upsertPush(p: Omit<PushSubscriptionRow, "id" | "created_at">) {
    const existing = this.push.get(p.endpoint);
    this.push.set(p.endpoint, { ...p, id: existing?.id ?? randomUUID(), created_at: existing?.created_at ?? new Date().toISOString() });
  }
  async listPush(memberIds: string[]) {
    return [...this.push.values()].filter((p) => memberIds.includes(p.member_id));
  }
  async deletePush(endpoint: string) {
    this.push.delete(endpoint);
  }
  async deleteMemberPush(memberId: string) {
    for (const [k, p] of this.push) if (p.member_id === memberId) this.push.delete(k);
  }
}

const MEMBER_COLUMNS = "id, name, phone, role, password_hash, active, failed_logins, locked_until, last_login_at, deactivated_at, created_at, updated_at";

/** Server-only auth storage in Supabase, with the service role key. */
export class SupabaseAuthStore implements AuthStore {
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async countMembers() {
    const { count, error } = await this.db.from("team_members").select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
  async listMembers() {
    return many<MemberRow>(await this.db.from("team_members").select(MEMBER_COLUMNS)).map(toMember).sort(byRoleThenName);
  }
  async getMember(id: string) {
    return one<MemberRow>(await this.db.from("team_members").select(MEMBER_COLUMNS).eq("id", id).maybeSingle());
  }
  async findMemberByPhone(phone: string) {
    return one<MemberRow>(await this.db.from("team_members").select(MEMBER_COLUMNS).eq("phone", phone).maybeSingle());
  }
  async insertMember(m: { name: string; phone: string; role: Role; password_hash?: string | null }) {
    const { data, error } = await this.db.from("team_members").insert(m).select(MEMBER_COLUMNS).single();
    if (error?.code === "23505") {
      throw new DuplicateError(error.message.includes("one_owner") ? "The CRM already has an owner." : "That mobile number is already on the team.");
    }
    if (error) throw new Error(error.message);
    return data as MemberRow;
  }
  async updateMember(id: string, patch: MemberPatch) {
    const { data, error } = await this.db
      .from("team_members")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(MEMBER_COLUMNS)
      .single();
    if (error?.code === "23505") throw new DuplicateError("The CRM already has an owner.");
    if (error) throw new Error(error.message);
    return data as MemberRow;
  }

  async insertSession(s: Omit<Session, "id" | "created_at" | "last_seen_at">) {
    return must<Session>(await this.db.from("team_sessions").insert(s).select().single());
  }
  async findSession(tokenHash: string) {
    return one<Session>(await this.db.from("team_sessions").select("*").eq("token_hash", tokenHash).maybeSingle());
  }
  async touchSession(id: string, patch: Pick<Session, "last_seen_at" | "expires_at">) {
    const { error } = await this.db.from("team_sessions").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
  }
  async deleteSession(tokenHash: string) {
    const { error } = await this.db.from("team_sessions").delete().eq("token_hash", tokenHash);
    if (error) throw new Error(error.message);
  }
  async deleteMemberSessions(memberId: string) {
    return many<{ id: string }>(await this.db.from("team_sessions").delete().eq("member_id", memberId).select("id")).length;
  }
  async countSessions() {
    const rows = many<{ member_id: string }>(
      await this.db.from("team_sessions").select("member_id").gt("expires_at", new Date().toISOString()).limit(2000),
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.member_id] = (out[r.member_id] ?? 0) + 1;
    return out;
  }

  async insertInvite(i: Omit<Invite, "created_at" | "used_at">) {
    return must<Invite>(await this.db.from("team_invites").insert(i).select().single());
  }
  async findInvite(tokenHash: string) {
    return one<Invite>(await this.db.from("team_invites").select("*").eq("token_hash", tokenHash).maybeSingle());
  }
  async useInvite(tokenHash: string, at: string) {
    // One UPDATE ... WHERE used_at IS NULL: only the first caller gets the row back.
    const row = one<Invite>(
      await this.db.from("team_invites").update({ used_at: at }).eq("token_hash", tokenHash).is("used_at", null).select().maybeSingle(),
    );
    return !!row;
  }
  async deleteMemberInvites(memberId: string) {
    const { error } = await this.db.from("team_invites").delete().eq("member_id", memberId);
    if (error) throw new Error(error.message);
  }

  async upsertPush(p: Omit<PushSubscriptionRow, "id" | "created_at">) {
    const { error } = await this.db.from("push_subscriptions").upsert(p, { onConflict: "endpoint" });
    if (error) throw new Error(error.message);
  }
  async listPush(memberIds: string[]) {
    if (!memberIds.length) return [];
    return many<PushSubscriptionRow>(await this.db.from("push_subscriptions").select("*").in("member_id", memberIds));
  }
  async deletePush(endpoint: string) {
    const { error } = await this.db.from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) throw new Error(error.message);
  }
  async deleteMemberPush(memberId: string) {
    const { error } = await this.db.from("push_subscriptions").delete().eq("member_id", memberId);
    if (error) throw new Error(error.message);
  }
}

type Result<T> = { data: T | null; error: { message: string } | null };

function one<T>({ data, error }: Result<T>): T | null {
  if (error) throw new Error(error.message);
  return data;
}

function must<T>(r: Result<T>): T {
  const row = one(r);
  if (!row) throw new Error("No row returned");
  return row;
}

function many<T>({ data, error }: Result<T[]>): T[] {
  if (error) throw new Error(error.message);
  return data ?? [];
}
