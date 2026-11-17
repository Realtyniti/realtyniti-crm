import { beforeEach, describe, expect, it } from "vitest";
import { MemoryAuthStore, type Member } from "@/lib/auth/store";
import {
  acceptInvite,
  addMember,
  AuthError,
  changePassword,
  changeRole,
  deactivateMember,
  inviteFor,
  LOCK_MINUTES,
  MAX_FAILED,
  reactivateMember,
  reassignAll,
  resetMember,
  resolveSession,
  setupOwner,
  signIn,
  signOut,
} from "@/lib/auth/team";
import { can, isViewOnly, ROLES, type Permission } from "@/lib/auth/roles";
import { maskedStore, maskPhone, maskText } from "@/lib/store/masked";
import { hashToken, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { captureLead } from "@/lib/leads";
import { MemoryStore } from "@/lib/store/memory";
import { readOnly } from "@/lib/store/read-only-store";
import { AccessError, scopedStore } from "@/lib/store/scoped";
import { notifyAssigned, notifyNewLead } from "@/lib/push";

const ENV = { adminPassword: "old-shared-pass", production: true };
const PW = "correct horse 1";

let auth: MemoryAuthStore;
let owner: Member;

async function newOwner() {
  const r = await setupOwner(auth, { name: "Chetan", phone: "87662 47768", password: PW, confirm: PW, setupKey: "old-shared-pass" }, ENV);
  return r.member;
}

/** Adds someone and has them set their password from the link. */
async function join(name: string, phone: string, role: "manager" | "agent") {
  const { member, token } = await addMember(auth, owner, { name, phone, role });
  const s = await acceptInvite(auth, { token, password: PW, confirm: PW });
  return { member, session: s.token };
}

beforeEach(async () => {
  auth = new MemoryAuthStore();
  owner = await newOwner();
});

describe("first-time owner setup", () => {
  it("needs the CRM's current shared password", async () => {
    const fresh = new MemoryAuthStore();
    await expect(
      setupOwner(fresh, { name: "X", phone: "9876543210", password: PW, confirm: PW, setupKey: "guess" }, ENV),
    ).rejects.toThrow(/current CRM password/);
    expect(await fresh.countMembers()).toBe(0);
  });

  it("is closed in production when no shared password is set", async () => {
    const fresh = new MemoryAuthStore();
    await expect(
      setupOwner(fresh, { name: "X", phone: "9876543210", password: PW, confirm: PW, setupKey: "" }, { production: true }),
    ).rejects.toThrow(/closed/);
  });

  it("works once only: a second setup is refused", async () => {
    expect(owner.role).toBe("owner");
    expect(owner.phone).toBe("+918766247768");
    await expect(
      setupOwner(auth, { name: "Someone", phone: "9876543210", password: PW, confirm: PW, setupKey: "old-shared-pass" }, ENV),
    ).rejects.toThrow(/already set up/);
  });

  it("stores only a scrypt hash, never the password", async () => {
    const row = await auth.getMember(owner.id);
    expect(row!.password_hash).toMatch(/^scrypt\$/);
    expect(row!.password_hash).not.toContain(PW);
    expect(await verifyPassword(PW, row!.password_hash)).toBe(true);
    expect(await verifyPassword("wrong", row!.password_hash)).toBe(false);
  });

  it("rejects weak or mismatched passwords", async () => {
    expect(passwordProblem("short")).toBeTruthy();
    expect(passwordProblem("12345678")).toBeTruthy();
    expect(passwordProblem("good password")).toBeNull();
    const fresh = new MemoryAuthStore();
    await expect(
      setupOwner(fresh, { name: "X", phone: "9876543210", password: PW, confirm: "other one 1", setupKey: "old-shared-pass" }, ENV),
    ).rejects.toThrow(/don't match/);
  });
});

describe("sign in", () => {
  it("signs in with mobile number in any format and the password", async () => {
    const r = await signIn(auth, { phone: "+91 87662-47768", password: PW });
    expect(r.member.id).toBe(owner.id);
    expect(await resolveSession(auth, r.token)).toMatchObject({ id: owner.id, role: "owner" });
    // Only the hash of the cookie token is stored.
    expect(await auth.findSession(r.token)).toBeNull();
    expect(await auth.findSession(hashToken(r.token))).not.toBeNull();
  });

  it("gives the same answer for an unknown number and a wrong password", async () => {
    const a = await signIn(auth, { phone: "9999999999", password: PW }).catch((e) => e);
    const b = await signIn(auth, { phone: "8766247768", password: "wrong pass 1" }).catch((e) => e);
    expect(a).toBeInstanceOf(AuthError);
    expect(a.message).toBe(b.message);
  });

  it(`pauses the login after ${MAX_FAILED} wrong tries, even for the right password`, async () => {
    const now = new Date("2026-11-17T10:00:00Z");
    for (let i = 0; i < MAX_FAILED; i++) await signIn(auth, { phone: "8766247768", password: "nope nope" }, now).catch(() => {});
    await expect(signIn(auth, { phone: "8766247768", password: PW }, now)).rejects.toThrow(/Too many/);
    const later = new Date(now.getTime() + (LOCK_MINUTES + 1) * 60_000);
    await expect(signIn(auth, { phone: "8766247768", password: PW }, later)).resolves.toBeTruthy();
  });

  it("signing out ends only that device", async () => {
    const a = await signIn(auth, { phone: "8766247768", password: PW });
    const b = await signIn(auth, { phone: "8766247768", password: PW });
    await signOut(auth, a.token);
    expect(await resolveSession(auth, a.token)).toBeNull();
    expect(await resolveSession(auth, b.token)).not.toBeNull();
  });

  it("an expired session is not accepted", async () => {
    const r = await signIn(auth, { phone: "8766247768", password: PW });
    expect(await resolveSession(auth, r.token, new Date(Date.now() + 31 * 24 * 3600_000))).toBeNull();
  });
});

describe("team members and invite links", () => {
  it("the owner adds an agent; the link sets their password once and signs them in", async () => {
    const { member, token } = await addMember(auth, owner, { name: "Ravi Kumar", phone: "98765 43210", role: "agent" });
    expect(member).toMatchObject({ role: "agent", active: true, has_password: false });
    expect(await inviteFor(auth, token)).toMatchObject({ id: member.id });
    const s = await acceptInvite(auth, { token, password: PW, confirm: PW });
    expect(await resolveSession(auth, s.token)).toMatchObject({ id: member.id, role: "agent" });
    // Used once: the same link no longer works.
    expect(await inviteFor(auth, token)).toBeNull();
    await expect(acceptInvite(auth, { token, password: PW, confirm: PW })).rejects.toThrow(/expired|used/);
    expect((await signIn(auth, { phone: "9876543210", password: PW })).member.id).toBe(member.id);
  });

  it("links expire after 7 days", async () => {
    const { token } = await addMember(auth, owner, { name: "A", phone: "9876543210", role: "agent" });
    expect(await inviteFor(auth, token, new Date(Date.now() + 8 * 24 * 3600_000))).toBeNull();
  });

  it("only the owner adds people, and nobody can be made a second owner", async () => {
    const { member: mgr } = await join("Manager", "9876500001", "manager");
    await expect(addMember(auth, mgr, { name: "B", phone: "9876500002", role: "agent" })).rejects.toThrow(/Only the owner/);
    await expect(addMember(auth, owner, { name: "B", phone: "9876500002", role: "owner" })).rejects.toThrow(/Manager, Agent or Reviewer/);
    await expect(changeRole(auth, owner, mgr.id, "owner")).rejects.toThrow(/Manager, Agent or Reviewer/);
    await expect(changeRole(auth, owner, owner.id, "agent")).rejects.toThrow(/owner login/);
  });

  it("refuses a mobile number already on the team", async () => {
    await expect(addMember(auth, owner, { name: "Dup", phone: "8766247768", role: "agent" })).rejects.toThrow(/already on the team/);
  });

  it("a new link signs the person out everywhere and the old link stops working", async () => {
    const { member, token: first } = await addMember(auth, owner, { name: "A", phone: "9876543210", role: "agent" });
    const s = await acceptInvite(auth, { token: first, password: PW, confirm: PW });
    const second = await resetMember(auth, owner, member.id);
    expect(await resolveSession(auth, s.token)).toBeNull();
    const again = await acceptInvite(auth, { token: second, password: "brand new pass", confirm: "brand new pass" });
    expect(await resolveSession(auth, again.token)).toMatchObject({ id: member.id });
    await expect(signIn(auth, { phone: "9876543210", password: PW })).rejects.toThrow();
  });

  it("changing your own password signs out your other devices", async () => {
    const a = await signIn(auth, { phone: "8766247768", password: PW });
    await expect(changePassword(auth, owner, { current: "wrong", password: "another pass 1", confirm: "another pass 1" })).rejects.toThrow(/current password/);
    const fresh = await changePassword(auth, owner, { current: PW, password: "another pass 1", confirm: "another pass 1" });
    expect(await resolveSession(auth, a.token)).toBeNull();
    expect(await resolveSession(auth, fresh)).not.toBeNull();
  });
});

describe("deactivate", () => {
  it("blocks the login on every device at once and keeps the person's leads", async () => {
    const store = new MemoryStore();
    const { member: agent, session: phone1 } = await join("Ravi", "9876543210", "agent");
    const phone2 = (await signIn(auth, { phone: "9876543210", password: PW })).token;
    const { lead } = await captureLead(store, { source: "website", phone: "9811111111" });
    await store.updateLead(lead.id, { assigned_to: agent.id });
    await auth.upsertPush({ member_id: agent.id, endpoint: "https://push.example/1", p256dh: "k", auth: "a", user_agent: null });

    const r = await deactivateMember(auth, owner, agent.id);
    expect(r.devices).toBe(2);
    expect(await resolveSession(auth, phone1)).toBeNull();
    expect(await resolveSession(auth, phone2)).toBeNull();
    await expect(signIn(auth, { phone: "9876543210", password: PW })).rejects.toThrow(/switched off/);
    expect(await auth.listPush([agent.id])).toHaveLength(0);
    // Their lead is untouched until someone reassigns it.
    expect((await store.getLead(lead.id))!.assigned_to).toBe(agent.id);
  });

  it("a session that slipped through is still refused because the member is inactive", async () => {
    const { member: agent, session } = await join("Ravi", "9876543210", "agent");
    await auth.updateMember(agent.id, { active: false });
    expect(await resolveSession(auth, session)).toBeNull();
  });

  it("an unused link stops working too", async () => {
    const { member, token } = await addMember(auth, owner, { name: "A", phone: "9876543210", role: "agent" });
    await deactivateMember(auth, owner, member.id);
    expect(await inviteFor(auth, token)).toBeNull();
  });

  it("only the owner deactivates, and the owner can't be deactivated", async () => {
    const { member: mgr } = await join("Manager", "9876500001", "manager");
    const { member: agent } = await join("Agent", "9876500002", "agent");
    await expect(deactivateMember(auth, mgr, agent.id)).rejects.toThrow(/Only the owner/);
    await expect(deactivateMember(auth, owner, owner.id)).rejects.toThrow(/owner login/);
  });

  it("reactivating lets them back in with their old password", async () => {
    const { member: agent } = await join("Ravi", "9876543210", "agent");
    await deactivateMember(auth, owner, agent.id);
    await reactivateMember(auth, owner, agent.id);
    await expect(signIn(auth, { phone: "9876543210", password: PW })).resolves.toBeTruthy();
  });

  it("hands all of someone's leads to another active member", async () => {
    const store = new MemoryStore();
    const { member: a } = await join("A", "9876500001", "agent");
    const { member: b } = await join("B", "9876500002", "agent");
    for (const p of ["9811111111", "9811111112"]) {
      const { lead } = await captureLead(store, { source: "website", phone: p });
      await store.updateLead(lead.id, { assigned_to: a.id });
    }
    await deactivateMember(auth, owner, a.id);
    await expect(reassignAll(auth, store, owner, b.id, a.id)).rejects.toThrow(/active/);
    expect(await reassignAll(auth, store, owner, a.id, b.id)).toBe(2);
    expect((await store.listLeads({ assignedTo: b.id })).length).toBe(2);
    await expect(reassignAll(auth, store, b, b.id, null)).rejects.toThrow(/owner or a manager/);
  });
});

describe("roles", () => {
  it("owner: everything; manager: all leads and assigning, no settings or team; agent: own leads only", () => {
    const perms: Permission[] = ["leads.all", "leads.assign", "leads.import", "leads.control", "visits.slots", "projects.edit", "insights", "settings", "team"];
    const table = Object.fromEntries(ROLES.map((r) => [r, perms.filter((p) => can(r, p))]));
    expect(table.owner).toEqual(perms);
    expect(table.manager).toEqual(["leads.all", "leads.assign", "leads.import", "leads.control", "visits.slots", "projects.edit", "insights"]);
    expect(table.agent).toEqual([]);
    expect(can(null, "leads.all")).toBe(false);
  });
});

describe("an agent's view of the leads", () => {
  let store: MemoryStore;
  let mine: string;
  let theirs: string;
  const AGENT = "agent-1";

  beforeEach(async () => {
    store = new MemoryStore();
    mine = (await captureLead(store, { source: "website", phone: "9811111111", name: "Mine" })).lead.id;
    theirs = (await captureLead(store, { source: "meta", phone: "9822222222", name: "Theirs" })).lead.id;
    await captureLead(store, { source: "meta", phone: "9833333333", name: "Unassigned" });
    await store.updateLead(mine, { assigned_to: AGENT });
    await store.updateLead(theirs, { assigned_to: "agent-2" });
  });

  it("lists, counts and searches only their own leads", async () => {
    const s = scopedStore(store, AGENT);
    expect((await s.listLeads()).map((l) => l.name)).toEqual(["Mine"]);
    expect((await s.queryLeads({ view: "all" })).rows.map((l) => l.name)).toEqual(["Mine"]);
    expect((await s.queryLeads({ view: "all", q: "Theirs" })).total).toBe(0);
    expect((await s.countLeads(["all", "open"])).all).toBe(1);
    expect(await s.leadFacts()).toHaveLength(1);
    // Asking for someone else's leads by filter still returns only their own.
    expect((await s.queryLeads({ view: "all", assignee: "agent-2" })).rows.map((l) => l.name)).toEqual(["Mine"]);
  });

  it("someone else's lead looks like it doesn't exist, and can't be changed", async () => {
    const s = scopedStore(store, AGENT);
    expect(await s.getLead(theirs)).toBeNull();
    expect(await s.findLeadByPhone("+919822222222")).toBeNull();
    await expect(s.listEvents(theirs)).rejects.toBeInstanceOf(AccessError);
    await expect(s.listWaMessages(theirs)).rejects.toBeInstanceOf(AccessError);
    await expect(s.updateLead(theirs, { notes: "x" })).rejects.toBeInstanceOf(AccessError);
    await expect(s.addEvent({ lead_id: theirs, kind: "note", channel: null, body: "x" })).rejects.toBeInstanceOf(AccessError);
  });

  it("can work their own lead but can't reassign it", async () => {
    const s = scopedStore(store, AGENT);
    await expect(s.updateLead(mine, { notes: "called" })).resolves.toMatchObject({ notes: "called" });
    await expect(s.addEvent({ lead_id: mine, kind: "note", channel: null, body: "ok", actor_id: AGENT })).resolves.toMatchObject({ actor_id: AGENT });
    await expect(s.updateLead(mine, { assigned_to: "agent-2" })).rejects.toThrow(/assign/);
  });

  it("can't touch settings, templates, projects, slots or bulk reassignment", async () => {
    const s = scopedStore(store, AGENT);
    await expect(s.updateWhatsAppSettings({ outbound_enabled: true })).rejects.toBeInstanceOf(AccessError);
    await expect(s.reassignLeads("agent-2", AGENT)).rejects.toBeInstanceOf(AccessError);
    await expect(s.upsertSpend({ source: "meta", month: "2026-11-01", amount_inr: 1 })).rejects.toBeInstanceOf(AccessError);
    expect((await store.getWhatsAppSettings()).outbound_enabled).toBe(false);
  });

  it("sees only site visits of their own leads", async () => {
    const slot = await store.insertSlot({ starts_at: "2026-12-01T05:00:00Z", ends_at: "2026-12-01T06:00:00Z", area: "Noida", address: null, map_url: null, capacity: 5, is_open: true });
    const v1 = await store.insertVisit({ lead_id: mine, slot_id: slot.id, project_interest: null, pickup: null, people: 1, status: "booked" });
    const v2 = await store.insertVisit({ lead_id: theirs, slot_id: slot.id, project_interest: null, pickup: null, people: 1, status: "booked" });
    const s = scopedStore(store, AGENT);
    expect((await s.listVisits()).map((v) => v.id)).toEqual([v1.id]);
    expect(await s.listVisits({ leadId: theirs })).toEqual([]);
    await expect(s.updateVisit(v2.id, { status: "done" })).rejects.toBeInstanceOf(AccessError);
    await expect(s.updateVisit(v1.id, { status: "done" })).resolves.toMatchObject({ status: "done" });
  });

  it("a read-only preview blocks bulk reassignment too", async () => {
    await expect(readOnly(store).reassignLeads("a", "b")).rejects.toThrow(/read-only/);
  });
});

describe("new-lead alerts", () => {
  it("go to the owner, managers and the assigned agent; not to other agents or deactivated people", async () => {
    const { member: mgr } = await join("Manager", "9876500001", "manager");
    const { member: a1 } = await join("A1", "9876500002", "agent");
    const { member: a2 } = await join("A2", "9876500003", "agent");
    const { member: gone } = await join("Gone", "9876500004", "manager");
    for (const m of [owner, mgr, a1, a2, gone]) {
      await auth.upsertPush({ member_id: m.id, endpoint: `https://push.example/${m.name}`, p256dh: "k", auth: "a", user_agent: null });
    }
    await deactivateMember(auth, owner, gone.id);
    const store = new MemoryStore();
    const { lead } = await captureLead(store, { source: "meta", phone: "9811111111", name: "Asha", property_type: "3bhk", micro_market: "Noida" });
    const assigned = await store.updateLead(lead.id, { assigned_to: a1.id });

    const sent: { endpoint: string; body: string }[] = [];
    const send = async (sub: { endpoint: string }, body: string) => void sent.push({ endpoint: sub.endpoint, body });
    expect(await notifyNewLead(auth, assigned, { send })).toBe(3);
    expect(sent.map((s) => s.endpoint).sort()).toEqual(["https://push.example/A1", "https://push.example/Chetan", "https://push.example/Manager"]);
    const payload = JSON.parse(sent[0].body);
    expect(payload).toMatchObject({ title: "New lead", url: `/leads/${lead.id}` });
    expect(payload.body).toContain("Asha");
    // The buyer's phone number never goes on a lock screen.
    expect(payload.body).not.toContain("9811111111");
  });

  it("skip the person who added the lead themselves", async () => {
    await auth.upsertPush({ member_id: owner.id, endpoint: "https://push.example/o", p256dh: "k", auth: "a", user_agent: null });
    const store = new MemoryStore();
    const { lead } = await captureLead(store, { source: "call", phone: "9811111111" });
    let n = 0;
    expect(await notifyNewLead(auth, lead, { except: owner.id, send: async () => void n++ })).toBe(0);
    expect(n).toBe(0);
  });

  it("forget a phone that has uninstalled the app (410) and never break intake", async () => {
    await auth.upsertPush({ member_id: owner.id, endpoint: "https://push.example/gone", p256dh: "k", auth: "a", user_agent: null });
    const store = new MemoryStore();
    const { lead } = await captureLead(store, { source: "call", phone: "9811111111" });
    const send = async () => {
      throw Object.assign(new Error("Gone"), { statusCode: 410 });
    };
    expect(await notifyNewLead(auth, lead, { send })).toBe(0);
    expect(await auth.listPush([owner.id])).toHaveLength(0);
    expect(await notifyAssigned(auth, lead, owner.id, send)).toBe(0);
  });

  it("send nothing (and fail nothing) when the alert keys aren't set", async () => {
    await auth.upsertPush({ member_id: owner.id, endpoint: "https://push.example/o", p256dh: "k", auth: "a", user_agent: null });
    const store = new MemoryStore();
    const { lead } = await captureLead(store, { source: "call", phone: "9811111111" });
    delete process.env.VAPID_PUBLIC_KEY;
    expect(await notifyNewLead(auth, lead)).toBe(0);
  });
});

describe("view-only reviewer (Meta App Review)", () => {
  it("the owner can add one; it is never offered for assigning leads", async () => {
    const { member, token } = await addMember(auth, owner, { name: "Meta Reviewer", phone: "90000 00001", role: "reviewer" });
    expect(member.role).toBe("reviewer");
    await acceptInvite(auth, { token, password: PW, confirm: PW });
    const store = new MemoryStore();
    const { member: a } = await join("A", "9876500002", "agent");
    const { lead } = await captureLead(store, { source: "website", phone: "9811111111" });
    await store.updateLead(lead.id, { assigned_to: a.id });
    await expect(reassignAll(auth, store, owner, a.id, member.id)).rejects.toThrow(/active/);
  });

  it("has no permissions except viewing the settings screens", () => {
    const perms: Permission[] = ["leads.all", "leads.assign", "leads.import", "leads.control", "visits.slots", "projects.edit", "insights", "settings", "team"];
    expect(perms.filter((p) => can("reviewer", p))).toEqual([]);
    expect(can("reviewer", "settings.view")).toBe(true);
    expect(isViewOnly("reviewer")).toBe(true);
    expect(isViewOnly("agent")).toBe(false);
  });

  it("sees every lead with phone numbers and emails masked, even inside notes and messages, and can't write", async () => {
    const store = new MemoryStore();
    const { lead } = await captureLead(store, { source: "meta", phone: "9876543210", name: "Asha", email: "asha.verma@gmail.com" });
    await store.addEvent({ lead_id: lead.id, kind: "note", channel: null, body: "Alert to Chetan: Asha +919876543210 asked for a call, mail asha.verma@gmail.com" });
    await store.updateWhatsAppSettings({ test_numbers: ["+918766247768"] });
    const view = readOnly(maskedStore(store));

    const seen = (await view.getLead(lead.id))!;
    expect(seen.phone).toBe("+91 98xxx xxx10");
    expect(seen.email).toBe("a***@gmail.com");
    expect((await view.queryLeads({ view: "all" })).rows[0].phone).toBe("+91 98xxx xxx10");
    const note = (await view.listEvents(lead.id)).find((e) => e.kind === "note")!;
    expect(note.body).not.toContain("9876543210");
    expect(note.body).not.toContain("asha.verma");
    expect((await view.listTouches(lead.id))[0].raw).toBeNull();
    expect((await view.getWhatsAppSettings()).test_numbers[0]).not.toContain("47768");
    // A number typed into search can't confirm who is a lead.
    expect((await view.queryLeads({ view: "all", q: "98765" })).total).toBe(1);
    expect(await view.findLeadByPhone("+919876543210")).toBeNull();

    await expect(view.updateLead(lead.id, { notes: "x" })).rejects.toThrow(/read-only/);
    await expect(view.addEvent({ lead_id: lead.id, kind: "note", channel: null, body: "x" })).rejects.toThrow(/read-only/);
    await expect(view.updateWhatsAppSettings({ outbound_enabled: true })).rejects.toThrow(/read-only/);
    // The real data is untouched.
    expect((await store.getLead(lead.id))!.phone).toBe("+919876543210");
  });

  it("masks short and foreign numbers safely", () => {
    expect(maskPhone("+447700900123")).toBe("+44 77xxx xxx23");
    expect(maskText("call 98765 43210 now")).toBe("call 98xxx xxx10 now");
    expect(maskText("Visit at 10:30, 2 people")).toBe("Visit at 10:30, 2 people");
  });
});
