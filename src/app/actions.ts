"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { captureLead, clearChetanFlag, closeLead, LeadError, saveTemplate, updateRequirement } from "@/lib/leads";
import { parseBudget, parseMicroMarket, parsePropertyType, parsePurpose, parseTimelineMonths } from "@/lib/parse";
import { markFollowedUp } from "@/lib/followup-clock";
import { importLeads } from "@/lib/import";
import { acceptedPatch, FIGURE_LABEL, figureChanges, figuresFromForm, projectFromForm, type FigureChange, type FigureKey } from "@/lib/projects";
import { getStore, getStoreFor } from "@/lib/store";
import { AccessError } from "@/lib/store/scoped";
import { actor, getAuthStore, PermissionError } from "@/lib/auth/session";
import { can, type Permission } from "@/lib/auth/roles";
import { notifyNewLead } from "@/lib/push";
import { normalisePhone } from "@/lib/phone";
import { isReadOnly, ReadOnlyError } from "@/lib/read-only";
import { setVisitStatus } from "@/lib/visits";
import { catcherConfig } from "@/lib/catcher-config";
import { sendManualReply, setAutoWhatsApp, settingsFromForm } from "@/lib/wa-reply";
import { LEAD_SOURCES, type LeadSource, type ProjectInput } from "@/lib/types";

export interface ActionState {
  error?: string;
  ok?: string;
}

function str(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function answersFrom(fd: FormData) {
  const budget = parseBudget(str(fd, "budget"));
  return {
    budget_min_inr: budget?.min ?? null,
    budget_max_inr: budget?.max ?? null,
    micro_market: parseMicroMarket(str(fd, "micro_market")),
    property_type: parsePropertyType(str(fd, "property_type")),
    purpose: parsePurpose(str(fd, "purpose")),
    timeline_months: parseTimelineMonths(str(fd, "timeline")),
    agreed_site_visit: fd.get("agreed_site_visit") === "on",
  };
}

async function run(fn: () => Promise<unknown>): Promise<ActionState | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof LeadError || e instanceof ReadOnlyError || e instanceof PermissionError || e instanceof AccessError) return { error: e.message };
    throw e;
  }
}

/** The signed-in member's store, after checking their role allows this. Throws PermissionError otherwise. */
async function storeFor(permission?: Permission) {
  const me = await actor(permission);
  return { me, store: getStoreFor(me) };
}

/** For forms: the same check, as a message instead of an exception. */
async function denied(permission?: Permission): Promise<ActionState | null> {
  try {
    await actor(permission);
    return null;
  } catch (e) {
    if (e instanceof PermissionError) return { error: e.message };
    throw e;
  }
}

export async function addLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  if (isReadOnly()) return { error: new ReadOnlyError().message };
  const source = str(fd, "source") as LeadSource | null;
  if (!source || !LEAD_SOURCES.includes(source)) return { error: "Pick where the lead came from." };
  const no = await denied();
  if (no) return no;
  const me = await actor();
  const store = getStore();
  // An agent can only add a number that is new to the CRM or already theirs; someone else's card stays private.
  if (!can(me.role, "leads.all")) {
    const phone = normalisePhone(str(fd, "phone"));
    const existing = phone ? await store.findLeadByPhone(phone) : null;
    if (existing && existing.assigned_to !== me.id) {
      return { error: "This number is already in the CRM with someone else. Ask the owner or a manager to assign it to you." };
    }
  }
  let id = "";
  const err = await run(async () => {
    const r = await captureLead(store, {
      source,
      phone: str(fd, "phone") ?? "",
      name: str(fd, "name"),
      email: str(fd, "email"),
      message: str(fd, "message"),
      ...answersFrom(fd),
    });
    id = r.lead.id;
    // A lead an agent adds is theirs.
    let lead = r.lead;
    if (r.created && !can(me.role, "leads.all")) lead = await store.updateLead(lead.id, { assigned_to: me.id });
    if (r.created) await notifyNewLead(getAuthStore(), lead, { except: me.id });
  });
  if (err) return err;
  revalidatePath("/");
  revalidatePath("/leads");
  redirect(`/leads/${id}`);
}

export async function updateLeadAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  if (isReadOnly()) return { error: new ReadOnlyError().message };
  const err = await run(async () =>
    updateRequirement((await storeFor()).store, id, {
      name: str(fd, "name"),
      email: str(fd, "email"),
      notes: str(fd, "notes"),
      ...answersFrom(fd),
    }),
  );
  if (err) return err;
  revalidatePath(`/leads/${id}`);
  revalidatePath("/");
  revalidatePath("/leads");
  return { ok: "Saved." };
}

export async function closeLeadAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  if (isReadOnly()) return { error: new ReadOnlyError().message };
  const outcome = str(fd, "outcome") === "converted" ? "converted" : "lost";
  const err = await run(async () => closeLead((await storeFor()).store, id, outcome, str(fd, "lost_reason")));
  if (err) return err;
  revalidatePath(`/leads/${id}`);
  revalidatePath("/");
  revalidatePath("/leads");
  return { ok: outcome === "lost" ? "Closed as lost." : "Marked converted." };
}

export async function clearFlagAction(id: string) {
  // Read-only preview: nothing to do; the banner says so.
  if (isReadOnly()) return;
  await clearChetanFlag((await storeFor("leads.control")).store, id);
  revalidatePath(`/leads/${id}`);
  revalidatePath("/");
  revalidatePath("/leads");
}

export async function addNoteAction(id: string, fd: FormData) {
  // Read-only preview: nothing to do; the banner says so.
  if (isReadOnly()) return;
  const body = str(fd, "body");
  if (!body) return;
  const { me, store } = await storeFor();
  await store.addEvent({ lead_id: id, kind: "note", channel: null, body, actor_id: me.id });
  revalidatePath(`/leads/${id}`);
}

export async function saveTemplateAction(key: string, _: ActionState, fd: FormData): Promise<ActionState> {
  if (isReadOnly()) return { error: new ReadOnlyError().message };
  const body = str(fd, "body") ?? "";
  const approve = fd.get("intent") === "approve";
  const err = await run(async () => saveTemplate((await storeFor("settings")).store, key, body, approve));
  if (err) return err;
  revalidatePath("/templates");
  return { ok: approve ? "Approved." : "Saved (not approved)." };
}

export async function createSlotsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  if (isReadOnly()) return { error: new ReadOnlyError().message };
  const no = await denied("visits.slots");
  if (no) return no;
  const date = str(fd, "date");
  const time = str(fd, "time");
  const area = str(fd, "area");
  const minutes = Number(str(fd, "minutes") ?? 60);
  const count = Math.min(12, Math.max(1, Number(str(fd, "count") ?? 1)));
  const capacity = Math.min(10, Math.max(1, Number(str(fd, "capacity") ?? 1)));
  if (!date || !time || !area) return { error: "Date, start time and area are needed." };
  // Times are entered in India time.
  const first = new Date(`${date}T${time}:00+05:30`);
  if (Number.isNaN(first.getTime())) return { error: "That date or time is not valid." };
  if (first.getTime() < Date.now()) return { error: "That time has already passed." };

  const store = getStore();
  for (let i = 0; i < count; i++) {
    const start = new Date(first.getTime() + i * minutes * 60_000);
    await store.insertSlot({
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
      area,
      address: str(fd, "address"),
      map_url: str(fd, "map_url"),
      capacity,
      is_open: true,
    });
  }
  revalidatePath("/visits");
  return { ok: `Opened ${count} slot${count === 1 ? "" : "s"}.` };
}

export async function toggleSlotAction(id: string, open: boolean) {
  // Read-only preview: nothing to do; the banner says so.
  if (isReadOnly()) return;
  await (await storeFor("visits.slots")).store.updateSlot(id, { is_open: open });
  revalidatePath("/visits");
}

export async function visitStatusAction(visitId: string, leadId: string, status: "done" | "no_show" | "cancelled") {
  // Read-only preview: nothing to do; the banner says so.
  if (isReadOnly()) return;
  await setVisitStatus((await storeFor()).store, visitId, leadId, status);
  revalidatePath("/visits");
  revalidatePath(`/leads/${leadId}`);
}

export async function importLeadsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  if (isReadOnly()) return { error: new ReadOnlyError().message };
  const no = await denied("leads.import");
  if (no) return no;
  const csv = str(fd, "csv");
  const fallback = str(fd, "source") as LeadSource | null;
  if (!csv) return { error: "Paste the leads first." };
  const result = await importLeads(getStore(), csv, fallback && LEAD_SOURCES.includes(fallback) ? fallback : "other");
  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath("/board");
  const parts = [`${result.created} new`, `${result.merged} added to existing cards`];
  if (result.closed) parts.push(`${result.closed} closed as lost`);
  return {
    ok: `Imported: ${parts.join(", ")}.`,
    error: result.errors.length ? `Skipped ${result.errors.length}: ${result.errors.slice(0, 5).join("; ")}` : undefined,
  };
}

export async function saveProjectAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  if (isReadOnly()) return { error: new ReadOnlyError().message };
  const no = await denied("projects.edit");
  if (no) return no;
  const input = projectFromForm(fd);
  if ("error" in input) return { error: input.error };
  const store = getStore();
  const confirmedToday = fd.get("confirmed_today") === "on";
  const existing = id ? await store.getProject(id) : null;
  const confirmation = confirmedToday
    ? { last_confirmed_at: new Date().toISOString(), confirmed_by: str(fd, "confirmed_by") ?? input.developer_contact_name ?? "Chetan" }
    : { last_confirmed_at: existing?.last_confirmed_at ?? null, confirmed_by: existing?.confirmed_by ?? null };
  const saved = existing
    ? await store.updateProject(existing.id, { ...input, ...confirmation })
    : await store.insertProject({ ...input, ...confirmation });
  revalidatePath("/projects");
  if (!existing) redirect(`/projects/${saved.id}`);
  revalidatePath(`/projects/${saved.id}`);
  return { ok: confirmedToday ? "Saved and marked confirmed today." : "Saved." };
}

export async function markFollowedUpAction(leadId: string, fd: FormData) {
  // Read-only preview: nothing to do; the banner says so.
  if (isReadOnly()) return;
  await markFollowedUp((await storeFor()).store, leadId, str(fd, "note"));
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/board");
}

export async function saveSpendAction(_: ActionState, fd: FormData): Promise<ActionState> {
  if (isReadOnly()) return { error: new ReadOnlyError().message };
  const no = await denied("insights");
  if (no) return no;
  const source = str(fd, "source") as LeadSource | null;
  const month = str(fd, "month");
  const amount = Number((str(fd, "amount") ?? "").replace(/[,₹\s]/g, ""));
  if (!source || !LEAD_SOURCES.includes(source) || !month || !Number.isFinite(amount) || amount < 0) {
    return { error: "Pick a channel and month, and enter the amount in rupees." };
  }
  await getStore().upsertSpend({ source, month: `${month}-01`, amount_inr: Math.round(amount) });
  revalidatePath("/channels");
  return { ok: "Saved." };
}

export interface FigureState {
  error?: string;
  ok?: string;
  changes?: FigureChange[];
  /** The reply as submitted, carried to the accept step. */
  reply?: Partial<ProjectInput>;
}

/** Step 1 of the Freshness Check: show the developer's figures beside the current ones. */
export async function compareFiguresAction(id: string, _: FigureState, fd: FormData): Promise<FigureState> {
  if (isReadOnly()) return { error: new ReadOnlyError().message };
  const no = await denied("projects.edit");
  if (no) return no;
  const project = await getStore().getProject(id);
  if (!project) return { error: "Project not found." };
  const reply = figuresFromForm(fd, project);
  const changes = figureChanges(project, reply);
  return { changes, reply };
}

/** Step 2: write only the ticked changes and mark the project confirmed now. */
export async function acceptFiguresAction(id: string, reply: Partial<ProjectInput>, _: FigureState, fd: FormData): Promise<FigureState> {
  if (isReadOnly()) return { error: new ReadOnlyError().message };
  const no = await denied("projects.edit");
  if (no) return no;
  const accepted = fd.getAll("accept").filter((v): v is FigureKey => typeof v === "string" && v in FIGURE_LABEL);
  await getStore().updateProject(id, acceptedPatch(reply, accepted, str(fd, "confirmed_by")));
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
  return { ok: accepted.length ? `Accepted ${accepted.length} change${accepted.length === 1 ? "" : "s"}; marked confirmed today.` : "No changes; marked confirmed today." };
}

export async function sendWhatsAppReplyAction(leadId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  if (isReadOnly()) return { error: new ReadOnlyError().message };
  const no = await denied();
  if (no) return no;
  const { store } = await storeFor();
  if (!(await store.getLead(leadId))) return { error: "Lead not found." };
  const r = await sendManualReply(store, catcherConfig(), {
    leadId,
    body: String(fd.get("body") ?? ""),
    sendKey: str(fd, "client_ref"),
  });
  revalidatePath(`/leads/${leadId}`);
  if (!r.ok) return { error: r.error };
  if (r.result.duplicate) return { ok: r.result.status === "sending" ? "Already being sent." : "Already sent." };
  return { ok: r.result.status === "dry_run" ? "Recorded as a dry run: WhatsApp is not connected." : "Sent." };
}

export async function setAutoWhatsAppAction(leadId: string, allowed: boolean) {
  // Read-only preview: nothing to do; the banner says so.
  if (isReadOnly()) return;
  await setAutoWhatsApp((await storeFor("leads.control")).store, leadId, allowed);
  revalidatePath(`/leads/${leadId}`);
}

export async function saveWhatsAppSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  if (isReadOnly()) return { error: new ReadOnlyError().message };
  const no = await denied("settings");
  if (no) return no;
  const { patch, invalid } = settingsFromForm(fd);
  if (invalid.length) return { error: `Not a valid phone number: ${invalid.join(", ")}` };
  await getStore().updateWhatsAppSettings(patch);
  revalidatePath("/whatsapp");
  return { ok: "Saved." };
}
