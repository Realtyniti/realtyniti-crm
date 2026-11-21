import "server-only";
import { NextResponse } from "next/server";
import { can, type Permission } from "./roles";
import { currentMember } from "./session";

/** For admin API routes: null when the signed-in member may call it, otherwise the error response to return. */
export async function apiDenied(permission: Permission): Promise<NextResponse | null> {
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(me.role, permission)) return NextResponse.json({ error: "Only the owner can do this." }, { status: 403 });
  return null;
}
