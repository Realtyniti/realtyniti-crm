import "server-only";
import type { CatcherConfig } from "./catcher";
import { normalisePhone } from "./phone";
import { CloudApiSender, DryRunSender, type WhatsAppSender } from "./whatsapp";

let sender: WhatsAppSender | undefined;

/** WhatsApp is live when the Cloud API number and token are set; otherwise every send is a dry run. */
export function catcherConfig(): CatcherConfig {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  sender ??= id && token ? new CloudApiSender(id, token) : new DryRunSender();
  const language = process.env.WHATSAPP_TEMPLATE_LANG || "en";
  const opener = process.env.WHATSAPP_OPENER_TEMPLATE;
  const alert = process.env.WHATSAPP_ALERT_TEMPLATE;
  return {
    sender,
    chetanPhone: normalisePhone(process.env.CHETAN_WHATSAPP),
    openerTemplate: opener ? { name: opener, language } : null,
    alertTemplate: alert ? { name: alert, language } : null,
  };
}
