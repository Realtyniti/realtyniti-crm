import webpush from "web-push";
import type { AuthStore } from "./auth/store";
import { can } from "./auth/roles";
import { isReadOnly } from "./read-only";
import { SOURCE_LABEL } from "@/components/badges";
import type { Lead } from "./types";

/*
 * New-lead alerts on phones and computers (Web Push). Each device opts in from "My account".
 * Needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY; without them nothing is sent and nothing fails.
 * Alerts never carry the buyer's phone number, since they show on a locked screen.
 */

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function configured(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://tathyahomes.com", pub, priv);
  return true;
}

type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, body: string) => Promise<unknown>;
const defaultSender: Sender = (sub, body) => webpush.sendNotification(sub, body, { TTL: 6 * 3600, urgency: "high" });

/** Sends to every device of these members. Returns how many devices accepted it. Gone devices are forgotten. */
export async function sendToMembers(auth: AuthStore, memberIds: string[], payload: PushPayload, send: Sender | null = null): Promise<number> {
  if (isReadOnly() || !memberIds.length) return 0;
  const sender = send ?? (configured() ? defaultSender : null);
  if (!sender) return 0;
  const subs = await auth.listPush([...new Set(memberIds)]);
  const body = JSON.stringify(payload);
  let ok = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
        ok++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410: the browser dropped this subscription (app removed, permission withdrawn).
        if (status === 404 || status === 410) await auth.deletePush(s.endpoint).catch(() => {});
        else console.error("push failed", status ?? e);
      }
    }),
  );
  return ok;
}

function leadLine(lead: Lead): string {
  const what = [lead.property_type, lead.micro_market].filter(Boolean).join(" in ");
  return [lead.name || "New enquiry", SOURCE_LABEL[lead.first_source] ?? lead.first_source, what].filter(Boolean).join(" · ");
}

/** A new lead arrived: tell the owner and managers, and the agent it is assigned to (if any). */
export async function notifyNewLead(auth: AuthStore, lead: Lead, opts: { except?: string; send?: Sender } = {}): Promise<number> {
  try {
    const members = (await auth.listMembers()).filter((m) => m.active);
    const ids = members
      .filter((m) => can(m.role, "leads.all") || m.id === lead.assigned_to)
      .map((m) => m.id)
      .filter((id) => id !== opts.except);
    return await sendToMembers(auth, ids, { title: "New lead", body: leadLine(lead), url: `/leads/${lead.id}`, tag: `lead-${lead.id}` }, opts.send ?? null);
  } catch (e) {
    // An alert must never break lead intake.
    console.error("new-lead alert failed", e);
    return 0;
  }
}

/** A lead was handed to an agent. */
export async function notifyAssigned(auth: AuthStore, lead: Lead, memberId: string, send?: Sender): Promise<number> {
  try {
    return await sendToMembers(auth, [memberId], { title: "Lead assigned to you", body: leadLine(lead), url: `/leads/${lead.id}`, tag: `lead-${lead.id}` }, send ?? null);
  } catch (e) {
    console.error("assignment alert failed", e);
    return 0;
  }
}
