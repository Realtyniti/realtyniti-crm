import { NextResponse } from "next/server";
import { catcherConfig } from "@/lib/catcher-config";
import { buildDigest } from "@/lib/digest";
import { getStore } from "@/lib/store";

/** Morning digest to Chetan. Called by Vercel Cron (see vercel.json) at 9:00 IST. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const cfg = catcherConfig();
  if (!cfg.chetanPhone) return NextResponse.json({ error: "CHETAN_WHATSAPP not set" }, { status: 503 });

  const store = getStore();
  const digest = buildDigest(await store.listLeads(), new Date(), await store.listProjects());
  if (!digest) return NextResponse.json({ sent: false, reason: "nothing to report" });
  if (cfg.alertTemplate) await cfg.sender.sendTemplate(cfg.chetanPhone, { ...cfg.alertTemplate, params: [digest] });
  else await cfg.sender.sendText(cfg.chetanPhone, digest);
  return NextResponse.json({ sent: cfg.sender.live, digest });
}
