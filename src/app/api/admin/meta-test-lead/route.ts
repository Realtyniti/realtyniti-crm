import { NextResponse } from "next/server";
import { graph, metaPageFor, pageAccessToken, type MetaForm } from "@/lib/intake/meta";

/**
 * Asks Meta to submit a test lead on the Page's first active form, so the whole
 * path (Meta -> webhook -> card) can be checked without spending on ads.
 * Meta allows one test lead per form; an earlier one is deleted first.
 */
export async function POST() {
  const env = process.env;
  const appSecret = env.META_APP_SECRET ?? null;
  const pageId = (env.META_PAGE_BRANDS ?? "").split(",")[0]?.split("=")[0]?.trim();
  const page = metaPageFor(pageId, env);
  if (!pageId || !page.token) return NextResponse.json({ error: "No Page or token configured" }, { status: 400 });
  try {
    const token = await pageAccessToken(pageId, page.token, appSecret);
    const forms = await graph<{ data: MetaForm[] }>(`${pageId}/leadgen_forms?fields=id,name,status&limit=50`, token, appSecret);
    const form = forms.data.find((f) => f.status === "ACTIVE") ?? forms.data[0];
    if (!form) return NextResponse.json({ error: "The Page has no lead forms" }, { status: 400 });
    const existing = await graph<{ data: { id: string }[] }>(`${form.id}/test_leads`, token, appSecret);
    for (const t of existing.data) await graph(t.id, token, appSecret, { method: "POST", params: { method: "delete" } }).catch(() => null);
    const created = await graph<{ id: string }>(`${form.id}/test_leads`, token, appSecret, {
      method: "POST",
      params: {
        field_data: JSON.stringify([
          { name: "full_name", values: ["CRM Test Lead"] },
          { name: "phone_number", values: ["+919000000001"] },
        ]),
      },
    });
    return NextResponse.json({ form: form.name, test_lead: created.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
