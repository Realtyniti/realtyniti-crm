"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { captureLead, clearChetanFlag, closeLead, LeadError, saveTemplate, updateRequirement } from "@/lib/leads";
import { parseBudget, parseMicroMarket, parsePropertyType, parsePurpose, parseTimelineMonths } from "@/lib/parse";
import { getStore } from "@/lib/store";
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
