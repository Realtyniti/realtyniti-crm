import { NextResponse } from "next/server";
import { handleInbound, handleReceipt } from "@/lib/catcher";
import { catcherConfig } from "@/lib/catcher-config";
import { verifyMetaSignature } from "@/lib/intake/meta";
import { getStore } from "@/lib/store";
import { inboundMessages, statusUpdates } from "@/lib/whatsapp";

/** Meta's one-time webhook verification handshake. */
export function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === token) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

/** Messages to the Realtyniti WhatsApp number, and delivery receipts for messages we sent. */
export async function POST(req: Request) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return NextResponse.json({ error: "META_APP_SECRET not set" }, { status: 503 });
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const body = JSON.parse(raw);
  const store = getStore();
  const cfg = catcherConfig();
  for (const msg of inboundMessages(body)) {
    try {
      await handleInbound(store, cfg, msg);
    } catch (e) {
      // Logged, not retried: the message is already on the card, and a retry could double-send.
      console.error("whatsapp inbound failed", msg.id, e);
    }
  }

  for (const update of statusUpdates(body)) {
    try {
      // A message Meta accepted but later failed: flag the lead and alert Chetan once. Never resent.
      await handleReceipt(store, cfg, update);
    } catch (e) {
      console.error("whatsapp status failed", update.wamid, e);
    }
  }
  return NextResponse.json({ ok: true });
}
