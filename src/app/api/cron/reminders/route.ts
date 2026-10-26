import { NextResponse } from "next/server";
import { catcherConfig } from "@/lib/catcher-config";
import { getStore } from "@/lib/store";
import { sendDueReminders } from "@/lib/visits";

/** Site-visit reminders. Called hourly (Supabase pg_cron), since Vercel's free plan only runs daily crons. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const sent = await sendDueReminders(getStore(), catcherConfig());
  return NextResponse.json({ sent });
}
