import { NextResponse } from "next/server";
import { greetNewLead } from "@/lib/catcher";
import { catcherConfig } from "@/lib/catcher-config";
import { captureLead } from "@/lib/leads";
import { fetchMetaLead, formName, leadgenChanges, metaLeadToInput, metaPageFor, pageAccessToken, verifyMetaSignature } from "@/lib/intake/meta";
import { getStore } from "@/lib/store";

/** Meta's one-time webhook verification handshake. */
export function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const token = process.env.META_VERIFY_TOKEN;
  if (token && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === token) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

/** New Meta lead form submissions (Facebook and Instagram lead ads). */
export async function POST(req: Request) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return NextResponse.json({ error: "META_APP_SECRET not set" }, { status: 503 });

  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const store = getStore();
  const results: { leadgen_id: string; ok: boolean; error?: string }[] = [];
  for (const change of leadgenChanges(JSON.parse(raw))) {
    try {
      const page = metaPageFor(change.page_id, process.env);
      if (!page.token) throw new Error(`No Page access token for Page ${change.page_id ?? "(unknown)"}`);
      // META_PAGE_ACCESS_TOKEN is a system-user token; it mints the Page token lead retrieval needs.
      const token = change.page_id ? await pageAccessToken(change.page_id, page.token, appSecret) : page.token;
      const lead = await fetchMetaLead(change.leadgen_id, token, appSecret);
      const result = await captureLead(store, metaLeadToInput(lead, page.brand));
      if (result.created) {
        const form = await formName(lead.form_id ?? change.form_id, token, appSecret);
        if (form) await store.addEvent({ lead_id: result.lead.id, kind: "note", channel: "meta", body: `Lead form: ${form}` });
        await greetNewLead(store, catcherConfig(), result.lead);
      }
      results.push({ leadgen_id: change.leadgen_id, ok: true });
    } catch (e) {
      console.error("meta intake failed", change.leadgen_id, e);
      results.push({ leadgen_id: change.leadgen_id, ok: false, error: (e as Error).message });
    }
  }
  // A non-2xx makes Meta retry; retries are safe because each lead id is stored once.
  const failed = results.some((r) => !r.ok);
  return NextResponse.json({ results }, { status: failed ? 500 : 200 });
}
