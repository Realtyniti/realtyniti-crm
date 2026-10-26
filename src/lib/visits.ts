import { createHmac, timingSafeEqual } from "node:crypto";
import { alertChetan, sendApproved, type CatcherConfig } from "./catcher";
import { classify } from "./intake-sop";
import { LeadError } from "./leads";
import type { Store } from "./store/types";
import type { Lead, SiteVisit, VisitSlot } from "./types";
import { windowOpen } from "./whatsapp";

/*
 * Realtyniti Site Visit Booker (SYS-03). Chetan opens slots; a buyer books one
 * from a personal link, and the visit lands on the card and the Visits page.
 * The booker never commits Chetan to a time he has not opened.
 */

/** Slots closer than this cannot be booked from the link, so Chetan always has notice. */
export const MIN_NOTICE_HOURS = 2;
export const PICKUP_POINTS = ["Noida Sector 18 metro", "Pari Chowk"] as const;

function sign(leadId: string, secret: string): string {
  return createHmac("sha256", secret).update(leadId).digest("base64url").slice(0, 22);
}

export function bookingToken(leadId: string, secret: string): string {
  return `${leadId}.${sign(leadId, secret)}`;
}

/** Returns the lead id if the token is genuine, otherwise null. */
export function verifyBookingToken(token: string, secret: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const leadId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(leadId, secret));
  return given.length === expected.length && timingSafeEqual(given, expected) ? leadId : null;
}

export const IST = "Asia/Kolkata";

/** "10:00 am–11:00 am" in India time. */
export function formatSlotTime(s: Pick<VisitSlot, "starts_at" | "ends_at">): string {
  const t = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit" });
  return `${t(s.starts_at)}–${t(s.ends_at)}`;
}

/** "Sat 7 Nov, 10:00 am–11:00 am" in India time. */
export function formatSlot(s: Pick<VisitSlot, "starts_at" | "ends_at">): string {
  const day = new Date(s.starts_at).toLocaleDateString("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short" });
  return `${day.replace(",", "")}, ${formatSlotTime(s)}`;
}

export interface SlotWithBookings extends VisitSlot {
  booked: SiteVisit[];
  spaceLeft: number;
}

export async function slotsWithBookings(store: Store, from: Date, openOnly = false): Promise<SlotWithBookings[]> {
  const slots = await store.listSlots({ from: from.toISOString(), openOnly });
  if (!slots.length) return [];
  const visits = await store.listVisits({ slotIds: slots.map((s) => s.id), status: "booked" });
  return slots.map((s) => {
    const booked = visits.filter((v) => v.slot_id === s.id);
    return { ...s, booked, spaceLeft: Math.max(0, s.capacity - booked.length) };
  });
}

/** What a buyer can pick from: open, not full, and at least MIN_NOTICE_HOURS away. */
export async function bookableSlots(store: Store, now = new Date()): Promise<SlotWithBookings[]> {
  const from = new Date(now.getTime() + MIN_NOTICE_HOURS * 3600_000);
  return (await slotsWithBookings(store, from, true)).filter((s) => s.spaceLeft > 0);
}

export interface BookingDetails {
  slotId: string;
  projectInterest?: string | null;
  pickup?: string | null;
  people?: number;
}

/** Book (or re-book) a visit. Re-booking cancels the old visit so its slot frees up. */
export async function bookVisit(
  store: Store,
  cfg: CatcherConfig,
  leadId: string,
  d: BookingDetails,
  now = new Date(),
): Promise<{ visit: SiteVisit; slot: VisitSlot; rescheduled: boolean }> {
  const lead = await store.getLead(leadId);
  if (!lead) throw new LeadError("This booking link is no longer valid.");
  const slot = (await bookableSlots(store, now)).find((s) => s.id === d.slotId);
  if (!slot) throw new LeadError("That time is no longer available. Please pick another.");

  const live = await store.listVisits({ leadId, status: "booked" });
  for (const v of live) await store.updateVisit(v.id, { status: "cancelled" });

  const visit = await store.insertVisit({
    lead_id: leadId,
    slot_id: slot.id,
    project_interest: d.projectInterest?.trim() || null,
    pickup: d.pickup?.trim() || null,
    people: Math.min(20, Math.max(1, d.people ?? 1)),
    status: "booked",
  });
  const updated = await store.updateLead(leadId, {
    status: lead.status === "converted" ? lead.status : "site_visit",
    agreed_site_visit: true,
    temperature: classify({ ...lead, agreed_site_visit: true }).temperature,
  });

  const when = formatSlot(slot);
  const rescheduled = live.length > 0;
  await store.addEvent({
    lead_id: leadId,
    kind: "status_change",
    channel: null,
    body: `${rescheduled ? "Visit rescheduled" : "Site visit booked"}: ${when}, ${slot.area}${visit.pickup ? `, pickup from ${visit.pickup}` : ""}, ${visit.people} ${visit.people === 1 ? "person" : "people"}${visit.project_interest ? `, interested in ${visit.project_interest}` : ""}.`,
  });

  await sendVisitMessage(store, cfg, updated, slot, "visit.confirmed");
  await alertChetan(
    store,
    cfg,
    updated,
    `📅 ${rescheduled ? "Visit moved" : "Visit booked"}: ${updated.name ?? updated.phone} ${updated.phone}, ${when}, ${slot.area}, ${visit.people} ppl${visit.pickup ? `, pickup ${visit.pickup}` : ""}${visit.project_interest ? `, wants ${visit.project_interest}` : ""}`,
  );
  return { visit, slot, rescheduled };
}

/** Free text only inside WhatsApp's 24-hour window; otherwise Chetan is told to message them. */
async function sendVisitMessage(store: Store, cfg: CatcherConfig, lead: Lead, slot: VisitSlot, key: string, now = new Date()) {
  if (!windowOpen(lead.last_inbound_at, now)) {
    await store.addEvent({
      lead_id: lead.id,
      kind: "flag",
      channel: "whatsapp",
      body: `"${key}" not sent: the buyer has not messaged in the last 24 hours, so WhatsApp only allows a registered template. Message them yourself.`,
    });
    return false;
  }
  return sendApproved(store, cfg, lead, key, {
    when: formatSlot(slot),
    area: slot.area,
    address: slot.address,
    map_url: slot.map_url,
    booking_link: cfg.bookingUrl?.(lead.id),
  });
}

export async function setVisitStatus(store: Store, visitId: string, leadId: string, status: SiteVisit["status"]) {
  const visit = await store.updateVisit(visitId, { status });
  const label = { booked: "booked", cancelled: "cancelled", done: "done", no_show: "a no-show" }[status];
  await store.addEvent({ lead_id: leadId, kind: "status_change", channel: null, body: `Site visit marked ${label}.` });
  return visit;
}

/** The evening before (from 6 PM IST) and two hours before. Called hourly. */
export async function sendDueReminders(store: Store, cfg: CatcherConfig, now = new Date()): Promise<number> {
  const slots = await slotsWithBookings(store, now);
  const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST });
  const istHour = Number(now.toLocaleString("en-GB", { timeZone: IST, hour: "2-digit", hour12: false }));
  const tomorrow = istDay(new Date(now.getTime() + 24 * 3600_000));
  let sent = 0;

  for (const slot of slots) {
    const start = new Date(slot.starts_at);
    const hoursAway = (start.getTime() - now.getTime()) / 3600_000;
    for (const v of slot.booked) {
      const lead = await store.getLead(v.lead_id);
      if (!lead) continue;
      if (!v.reminder_2h_sent_at && hoursAway <= 2 && hoursAway > 0) {
        await sendVisitMessage(store, cfg, lead, slot, "visit.reminder_2h", now);
        await store.updateVisit(v.id, { reminder_2h_sent_at: now.toISOString() });
        sent++;
      } else if (!v.reminder_evening_sent_at && !v.reminder_2h_sent_at && hoursAway > 2 && istDay(start) === tomorrow && istHour >= 18) {
        await sendVisitMessage(store, cfg, lead, slot, "visit.reminder_evening", now);
        await store.updateVisit(v.id, { reminder_evening_sent_at: now.toISOString() });
        sent++;
      }
    }
  }
  return sent;
}
