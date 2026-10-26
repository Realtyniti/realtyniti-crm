import { NextResponse } from "next/server";
import { metaPageFor, pageAccessToken, pageLeads, metaLeadToInput } from "@/lib/intake/meta";
import { captureLead } from "@/lib/leads";
import { getStore } from "@/lib/store";

export const maxDuration = 60;

/**
 * Brings leads already sitting in the Page's lead forms onto cards. Nothing is
 * sent to these buyers; they land as new leads for Chetan to work. Safe to run
 * again: each Meta lead id is stored once.
 */
export async function POST() {
  const env = process.env;
  const appSecret = env.META_APP_SECRET ?? null;
  const pageIds = (env.META_PAGE_BRANDS ?? "").split(",").map((p) => p.split("=")[0].trim()).filter(Boolean);
  const store = getStore();
  type PageSummary = { forms: Record<string, number>; created: number; merged: number; skipped: number; errors: string[] };
  const summary: Record<string, PageSummary> = {};

  for (const pageId of pageIds) {
    const page = metaPageFor(pageId, env);
    const s: PageSummary = (summary[pageId] = { forms: {}, created: 0, merged: 0, skipped: 0, errors: [] });
    if (!page.token) {
      s.errors.push("No token for this Page");
      continue;
    }
    try {
      const token = await pageAccessToken(pageId, page.token, appSecret);
      for await (const { form, lead } of pageLeads(pageId, token, appSecret)) {
        s.forms[form.name] = (s.forms[form.name] ?? 0) + 1;
        try {
          const r = await captureLead(store, metaLeadToInput(lead, page.brand));
          if (r.duplicateDelivery) s.skipped++;
          else if (r.created) {
            s.created++;
            await store.addEvent({ lead_id: r.lead.id, kind: "note", channel: "meta", body: `Lead form: ${form.name} (brought in from Meta's past leads; no message sent).` });
          } else s.merged++;
        } catch (e) {
          s.errors.push(`${lead.id}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      s.errors.push((e as Error).message);
    }
  }
  return NextResponse.json(summary);
}
