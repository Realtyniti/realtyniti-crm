"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  actor,
  clearSessionCookie,
  getAuthStore,
  PermissionError,
  sessionToken,
  setSessionCookie,
  userAgent,
} from "@/lib/auth/session";
import {
  acceptInvite,
  addMember,
  AuthError,
  changePassword,
  changeRole,
  deactivateMember,
  reactivateMember,
  reassignAll,
  resetMember,
  setupOwner,
  signIn,
  signOut,
} from "@/lib/auth/team";
import { can } from "@/lib/auth/roles";
import { notifyAssigned } from "@/lib/push";
import { isReadOnly } from "@/lib/read-only";
import { getStore } from "@/lib/store";

export interface TeamState {
  error?: string;
  ok?: string;
  /** A one-time link to show the owner once (new member or password reset). */
  link?: string;
  linkFor?: { name: string; phone: string };
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const raw = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

/** Only paths on this site, never "//other.site". */
function safeNext(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

async function caught<T extends TeamState>(fn: () => Promise<T>): Promise<T | TeamState> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthError || e instanceof PermissionError) return { error: e.message };
    throw e;
  }
}

const PREVIEW = "This is a read-only preview: change the team on the live CRM.";

async function joinLink(token: string): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const base = host ? `${proto}://${host}` : (process.env.APP_URL || "https://realtyniti-crm.vercel.app").replace(/\/$/, "");
  return `${base}/join/${token}`;
}

export async function loginAction(_: TeamState, fd: FormData): Promise<TeamState> {
  let ok = false;
  const r = await caught(async () => {
    const { token } = await signIn(getAuthStore(), { phone: str(fd, "phone"), password: raw(fd, "password"), userAgent: await userAgent() });
    await setSessionCookie(token);
    ok = true;
    return {};
  });
  if (!ok) return r;
  redirect(safeNext(str(fd, "next")));
}

export async function setupOwnerAction(_: TeamState, fd: FormData): Promise<TeamState> {
  let ok = false;
  const r = await caught(async () => {
    const { token } = await setupOwner(
      getAuthStore(),
      {
        name: str(fd, "name"),
        phone: str(fd, "phone"),
        password: raw(fd, "password"),
        confirm: raw(fd, "confirm"),
        setupKey: raw(fd, "setup_key"),
        userAgent: await userAgent(),
      },
      { adminPassword: process.env.ADMIN_PASSWORD || undefined, production: process.env.NODE_ENV === "production" },
    );
    await setSessionCookie(token);
    ok = true;
    return {};
  });
  if (!ok) return r;
  redirect("/team?welcome=1");
}

export async function joinAction(inviteToken: string, _: TeamState, fd: FormData): Promise<TeamState> {
  let ok = false;
  const r = await caught(async () => {
    const { token } = await acceptInvite(getAuthStore(), {
      token: inviteToken,
      password: raw(fd, "password"),
      confirm: raw(fd, "confirm"),
      userAgent: await userAgent(),
    });
    await setSessionCookie(token);
    ok = true;
    return {};
  });
  if (!ok) return r;
  redirect("/account?welcome=1");
}

export async function logoutAction() {
  await signOut(getAuthStore(), await sessionToken());
  await clearSessionCookie();
  redirect("/login");
}

export async function changePasswordAction(_: TeamState, fd: FormData): Promise<TeamState> {
  return caught(async () => {
    const me = await actor();
    const token = await changePassword(getAuthStore(), me, {
      current: raw(fd, "current"),
      password: raw(fd, "password"),
      confirm: raw(fd, "confirm"),
      userAgent: await userAgent(),
    });
    await setSessionCookie(token);
    return { ok: "Password changed. Your other devices have been signed out." };
  });
}

export async function addMemberAction(_: TeamState, fd: FormData): Promise<TeamState> {
  if (isReadOnly()) return { error: PREVIEW };
  return caught(async () => {
    const me = await actor("team");
    const { member, token } = await addMember(getAuthStore(), me, { name: str(fd, "name"), phone: str(fd, "phone"), role: str(fd, "role") });
    revalidatePath("/team");
    return { ok: `${member.name} added.`, link: await joinLink(token), linkFor: { name: member.name, phone: member.phone } };
  });
}

export async function resetLinkAction(memberId: string, previous: TeamState): Promise<TeamState> {
  void previous; // useActionState passes the last result; not needed here.
  if (isReadOnly()) return { error: PREVIEW };
  return caught(async () => {
    const me = await actor("team");
    const auth = getAuthStore();
    const token = await resetMember(auth, me, memberId);
    const m = await auth.getMember(memberId);
    revalidatePath("/team");
    return {
      ok: "New link made. Their old link and any signed-in devices have stopped working.",
      link: await joinLink(token),
      linkFor: m ? { name: m.name, phone: m.phone } : undefined,
    };
  });
}

export async function deactivateAction(memberId: string, previous: TeamState): Promise<TeamState> {
  void previous; // useActionState passes the last result; not needed here.
  if (isReadOnly()) return { error: PREVIEW };
  return caught(async () => {
    const me = await actor("team");
    const { member, devices } = await deactivateMember(getAuthStore(), me, memberId);
    revalidatePath("/team");
    return { ok: `${member.name} can no longer sign in${devices ? ` (signed out of ${devices} device${devices === 1 ? "" : "s"})` : ""}. Their leads are still here.` };
  });
}

export async function reactivateAction(memberId: string, previous: TeamState): Promise<TeamState> {
  void previous; // useActionState passes the last result; not needed here.
  if (isReadOnly()) return { error: PREVIEW };
  return caught(async () => {
    const me = await actor("team");
    const member = await reactivateMember(getAuthStore(), me, memberId);
    revalidatePath("/team");
    return { ok: `${member.name} can sign in again with their old password.` };
  });
}

export async function changeRoleAction(memberId: string, _: TeamState, fd: FormData): Promise<TeamState> {
  if (isReadOnly()) return { error: PREVIEW };
  return caught(async () => {
    const me = await actor("team");
    const member = await changeRole(getAuthStore(), me, memberId, str(fd, "role"));
    revalidatePath("/team");
    return { ok: `${member.name} is now ${{ owner: "the Owner", manager: "a Manager", agent: "an Agent", reviewer: "a view-only Reviewer" }[member.role]}.` };
  });
}

export async function reassignAllAction(fromId: string, _: TeamState, fd: FormData): Promise<TeamState> {
  if (isReadOnly()) return { error: PREVIEW };
  return caught(async () => {
    const me = await actor("leads.assign");
    const to = str(fd, "to") || null;
    const moved = await reassignAll(getAuthStore(), getStore(), me, fromId, to);
    revalidatePath("/team");
    revalidatePath("/leads");
    return { ok: moved ? `Moved ${moved} lead${moved === 1 ? "" : "s"}.` : "No leads to move." };
  });
}

/** Assign one lead (to a member id, or "" for nobody). Owner and managers only. */
export async function assignLeadAction(leadId: string, memberId: string | null): Promise<TeamState> {
  if (isReadOnly()) return { error: "This is a read-only preview. Nothing was saved." };
  return caught(async () => {
    const me = await actor("leads.assign");
    const auth = getAuthStore();
    const store = getStore();
    const lead = await store.getLead(leadId);
    if (!lead) return { error: "Lead not found." };
    const to = memberId ? await auth.getMember(memberId) : null;
    if (memberId && (!to || !to.active || to.role === "reviewer")) return { error: "Pick someone who is active on the team." };
    if (lead.assigned_to === (to?.id ?? null)) return { ok: "No change." };
    const updated = await store.updateLead(lead.id, { assigned_to: to?.id ?? null });
    await store.addEvent({
      lead_id: lead.id,
      kind: "status_change",
      channel: null,
      body: to ? `Assigned to ${to.name} by ${me.name}.` : `Unassigned by ${me.name}.`,
      actor_id: me.id,
    });
    if (to && to.id !== me.id && !can(to.role, "leads.all")) await notifyAssigned(auth, updated, to.id);
    revalidatePath(`/leads/${lead.id}`);
    revalidatePath("/leads");
    return { ok: to ? `Assigned to ${to.name}.` : "Unassigned." };
  });
}

/** This browser asks for new-lead alerts. */
export async function savePushAction(sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<TeamState> {
  return caught(async () => {
    const me = await actor();
    if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) return { error: "This browser gave an invalid alert address." };
    await getAuthStore().upsertPush({
      member_id: me.id,
      endpoint: sub.endpoint.slice(0, 1000),
      p256dh: sub.keys.p256dh.slice(0, 200),
      auth: sub.keys.auth.slice(0, 100),
      user_agent: (await userAgent())?.slice(0, 300) ?? null,
    });
    return { ok: "Alerts are on for this device." };
  });
}

export async function removePushAction(endpoint: string): Promise<TeamState> {
  return caught(async () => {
    const me = await actor();
    const auth = getAuthStore();
    const subs = await auth.listPush([me.id]);
    if (subs.some((s) => s.endpoint === endpoint)) await auth.deletePush(endpoint);
    return { ok: "Alerts are off for this device." };
  });
}

/** A test alert to all of this member's devices. */
export async function testPushAction(): Promise<TeamState> {
  return caught(async () => {
    const me = await actor();
    const { sendToMembers } = await import("@/lib/push");
    const sent = await sendToMembers(getAuthStore(), [me.id], {
      title: "RealtyNiti alerts work",
      body: "New leads will show up here like this.",
      url: "/leads",
      tag: "test",
    });
    return sent ? { ok: `Test alert sent to ${sent} device${sent === 1 ? "" : "s"}.` } : { error: "No device got it. Turn alerts on first, or check the server's alert keys." };
  });
}
