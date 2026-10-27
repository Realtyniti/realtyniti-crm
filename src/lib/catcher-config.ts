import "server-only";
import type { CatcherConfig } from "./catcher";
import { normalisePhone } from "./phone";
import { isReadOnly } from "./read-only";
import { bookingToken } from "./visits";
import { CloudApiSender, DryRunSender, type WhatsAppSender } from "./whatsapp";

let sender: WhatsAppSender | undefined;

/** WhatsApp is live when the Cloud API number and token are set (and this is not a read-only preview); otherwise every send is a dry run. */
export function catcherConfig(): CatcherConfig {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  sender ??= id && token && !isReadOnly() ? new CloudApiSender(id, token) : new DryRunSender();
  const language = process.env.WHATSAPP_TEMPLATE_LANG || "en";
  const opener = process.env.WHATSAPP_OPENER_TEMPLATE;
  const alert = process.env.WHATSAPP_ALERT_TEMPLATE;
  const followup = process.env.WHATSAPP_FOLLOWUP_TEMPLATE;
  return {
    sender,
    chetanPhone: normalisePhone(process.env.CHETAN_WHATSAPP),
    openerTemplate: opener ? { name: opener, language } : null,
    alertTemplate: alert ? { name: alert, language } : null,
    followupTemplate: followup ? { name: followup, language } : null,
    bookingUrl: bookingUrlFor,
  };
}

/** The buyer's personal Site Visit Booker link, or null when BOOKING_SECRET is not set. */
export function bookingUrlFor(leadId: string): string | null {
  const secret = process.env.BOOKING_SECRET;
  if (!secret) return null;
  const base = (process.env.APP_URL || "https://realtyniti-crm.vercel.app").replace(/\/$/, "");
  return `${base}/book/${bookingToken(leadId, secret)}`;
}
