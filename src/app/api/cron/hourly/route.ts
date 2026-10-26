import { NextResponse } from "next/server";
import { catcherConfig } from "@/lib/catcher-config";
import { runFollowUpClock } from "@/lib/followup-clock";
import { getStore } from "@/lib/store";
import { sendDueReminders } from "@/lib/visits";

/**
 * Hourly jobs: site-visit reminders and the Follow-up Clock. Called by Supabase
 * pg_cron, since Vercel's free plan only runs daily crons.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const store = getStore();
  const cfg = catcherConfig();
  const reminders = await sendDueReminders(store, cfg);
  const followups = await runFollowUpClock(store, cfg);
  return NextResponse.json({ reminders, followups });
}
