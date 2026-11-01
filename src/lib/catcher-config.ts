import "server-only";
import type { CatcherConfig } from "./catcher";
import { normalisePhone } from "./phone";
import { isReadOnly } from "./read-only";
import { bookingToken } from "./visits";
import { getStore } from "./store";
import { canAutomate, GatedSender } from "./wa-gate";
import { CloudApiSender, DryRunSender, type WhatsAppSender } from "./whatsapp";

let sender: WhatsAppSender | undefined;

/**
 * WhatsApp is connected when the Cloud API number and token are set (and this is not a read-only
 * preview); otherwise every send is a dry run. Either way every message passes the send gate, whose
 * switches start off, so setting the credentials alone sends nothing.
 */
export function catcherConfig(): CatcherConfig {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const store = getStore();
  const chetanPhone = normalisePhone(process.env.CHETAN_WHATSAPP);
  // A refusal at send time is flagged on the card by the caller; refusals reported later by Meta arrive as receipts (api/whatsapp).
  sender ??= new GatedSender(id && token && !isReadOnly() ? new CloudApiSender(id, token) : new DryRunSender(), store, { chetanPhone });
  const language = process.env.WHATSAPP_TEMPLATE_LANG || "en";
  const opener = process.env.WHATSAPP_OPENER_TEMPLATE;
  const alert = process.env.WHATSAPP_ALERT_TEMPLATE;
  const followup = process.env.WHATSAPP_FOLLOWUP_TEMPLATE;
  return {
    sender,
    chetanPhone,
    openerTemplate: opener ? { name: opener, language } : null,
    alertTemplate: alert ? { name: alert, language } : null,
    followupTemplate: followup ? { name: followup, language } : null,
    bookingUrl: bookingUrlFor,
    canAutomate: (lead) => canAutomate(store, lead),
  };
}

/** The buyer's personal Site Visit Booker link, or null when BOOKING_SECRET is not set. */
export function bookingUrlFor(leadId: string): string | null {
  const secret = process.env.BOOKING_SECRET;
  if (!secret) return null;
  const base = (process.env.APP_URL || "https://realtyniti-crm.vercel.app").replace(/\/$/, "");
  return `${base}/book/${bookingToken(leadId, secret)}`;
}
