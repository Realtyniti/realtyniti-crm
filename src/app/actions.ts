"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { captureLead, clearChetanFlag, closeLead, LeadError, saveTemplate, updateRequirement } from "@/lib/leads";
import { parseBudget, parseMicroMarket, parsePropertyType, parsePurpose, parseTimelineMonths } from "@/lib/parse";
import { markFollowedUp } from "@/lib/followup-clock";
import { importLeads } from "@/lib/import";
import { projectFromForm } from "@/lib/projects";
import { getStore } from "@/lib/store";
import { setVisitStatus } from "@/lib/visits";
import { LEAD_SOURCES, type LeadSource } from "@/lib/types";

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
    if (e instanceof LeadError) return { error: e.message };
    throw e;
  }
}

export async function addLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const source = str(fd, "source") as LeadSource | null;
  if (!source || !LEAD_SOURCES.includes(source)) return { error: "Pick where the lead came from." };
  let id = "";
  const err = await run(async () => {
    const r = await captureLead(getStore(), {
      source,
      phone: str(fd, "phone") ?? "",
      name: str(fd, "name"),
      email: str(fd, "email"),
      message: str(fd, "message"),
      ...answersFrom(fd),
    });
    id = r.lead.id;
  });
  if (err) return err;
  revalidatePath("/");
  redirect(`/leads/${id}`);
}

export async function updateLeadAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const err = await run(() =>
    updateRequirement(getStore(), id, {
      name: str(fd, "name"),
      email: str(fd, "email"),
      notes: str(fd, "notes"),
      ...answersFrom(fd),
    }),
  );
  if (err) return err;
  revalidatePath(`/leads/${id}`);
  revalidatePath("/");
  return { ok: "Saved." };
}

export async function closeLeadAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const outcome = str(fd, "outcome") === "converted" ? "converted" : "lost";
  const err = await run(() => closeLead(getStore(), id, outcome, str(fd, "lost_reason")));
  if (err) return err;
  revalidatePath(`/leads/${id}`);
  revalidatePath("/");
  return { ok: outcome === "lost" ? "Closed as lost." : "Marked converted." };
}

export async function clearFlagAction(id: string) {
  await clearChetanFlag(getStore(), id);
  revalidatePath(`/leads/${id}`);
  revalidatePath("/");
}

export async function addNoteAction(id: string, fd: FormData) {
  const body = str(fd, "body");
  if (!body) return;
  await getStore().addEvent({ lead_id: id, kind: "note", channel: null, body });
  revalidatePath(`/leads/${id}`);
}

export async function saveTemplateAction(key: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const body = str(fd, "body") ?? "";
  const approve = fd.get("intent") === "approve";
  const err = await run(() => saveTemplate(getStore(), key, body, approve));
  if (err) return err;
  revalidatePath("/templates");
  return { ok: approve ? "Approved." : "Saved (not approved)." };
}

export async function createSlotsAction(_: ActionState, fd: FormData): Promise<ActionState> {
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
  await getStore().updateSlot(id, { is_open: open });
  revalidatePath("/visits");
}

export async function visitStatusAction(visitId: string, leadId: string, status: "done" | "no_show" | "cancelled") {
  await setVisitStatus(getStore(), visitId, leadId, status);
  revalidatePath("/visits");
  revalidatePath(`/leads/${leadId}`);
}

export async function importLeadsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const csv = str(fd, "csv");
  const fallback = str(fd, "source") as LeadSource | null;
  if (!csv) return { error: "Paste the leads first." };
  const result = await importLeads(getStore(), csv, fallback && LEAD_SOURCES.includes(fallback) ? fallback : "other");
  revalidatePath("/");
  revalidatePath("/board");
  const parts = [`${result.created} new`, `${result.merged} added to existing cards`];
  if (result.closed) parts.push(`${result.closed} closed as lost`);
  return {
    ok: `Imported: ${parts.join(", ")}.`,
    error: result.errors.length ? `Skipped ${result.errors.length}: ${result.errors.slice(0, 5).join("; ")}` : undefined,
  };
}

export async function saveProjectAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
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
  await markFollowedUp(getStore(), leadId, str(fd, "note"));
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/board");
}

export async function saveSpendAction(_: ActionState, fd: FormData): Promise<ActionState> {
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
