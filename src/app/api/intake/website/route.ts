import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { captureLead, LeadError } from "@/lib/leads";
import { WebsiteFormSchema, websiteFormToLead } from "@/lib/intake/website";
import { getStore } from "@/lib/store";

function keyMatches(given: string | null, expected: string): boolean {
  if (!given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Website enquiry form. The site's form handler posts JSON here with the shared intake key. */
export async function POST(req: Request) {
  const secret = process.env.INTAKE_SECRET;
  if (!secret) return NextResponse.json({ error: "INTAKE_SECRET is not set" }, { status: 503 });
  if (!keyMatches(req.headers.get("x-intake-key"), secret)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const parsed = WebsiteFormSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  try {
    const result = await captureLead(getStore(), websiteFormToLead(parsed.data));
    return NextResponse.json({ id: result.lead.id, created: result.created }, { status: result.created ? 201 : 200 });
  } catch (e) {
    if (e instanceof LeadError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
