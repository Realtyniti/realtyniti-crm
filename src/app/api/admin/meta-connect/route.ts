import { NextResponse } from "next/server";
import { connectLeadgen } from "@/lib/intake/meta";

/**
 * Wires Meta lead ads to the CRM using the secrets already in Vercel, so they never
 * have to be pasted anywhere else. Behind the CRM password like every admin screen.
 */
export async function POST() {
  const env = process.env;
  const pageIds = (env.META_PAGE_BRANDS ?? "").split(",").map((p) => p.split("=")[0].trim()).filter(Boolean);
  const missing = ["META_APP_ID", "META_APP_SECRET", "META_PAGE_ACCESS_TOKEN", "META_VERIFY_TOKEN"].filter((k) => !env[k]);
  if (missing.length || !pageIds.length) {
    return NextResponse.json({ error: `Missing: ${[...missing, ...(pageIds.length ? [] : ["META_PAGE_BRANDS"])].join(", ")}` }, { status: 400 });
  }
  const base = (env.APP_URL || "https://realtyniti-crm.vercel.app").replace(/\/$/, "");
  const results: Record<string, Awaited<ReturnType<typeof connectLeadgen>>> = {};
  for (const pageId of pageIds) {
    results[pageId] = await connectLeadgen({
      appId: env.META_APP_ID!,
      appSecret: env.META_APP_SECRET!,
      pageId,
      token: env[`META_PAGE_ACCESS_TOKEN_${pageId}`] || env.META_PAGE_ACCESS_TOKEN!,
      callbackUrl: `${base}/api/intake/meta`,
      verifyToken: env.META_VERIFY_TOKEN!,
    });
  }
  const ok = Object.values(results).every((steps) => steps.length === 2 && steps.every((s) => s.ok));
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 502 });
}
