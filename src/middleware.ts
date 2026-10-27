import { NextResponse, type NextRequest } from "next/server";
import { isReadOnly } from "@/lib/read-only";

/** Open without the CRM password: webhooks and cron carry their own secrets; buyers open booking links. */
const PUBLIC = /^\/(api\/intake|api\/whatsapp|api\/cron|book\/|privacy)/;

/*
 * Chetan-only access. Every screen sits behind one password (ADMIN_PASSWORD).
 * Intake webhooks carry their own secrets and are left open here.
 */
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // A read-only preview serves screens only: no webhooks, cron or admin calls that could write or message anyone.
  if (isReadOnly() && path.startsWith("/api/")) {
    return new NextResponse("Read-only preview: API routes are switched off.", { status: 403 });
  }
  if (PUBLIC.test(path)) return NextResponse.next();

  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Set ADMIN_PASSWORD to open the CRM.", { status: 503 });
    }
    return NextResponse.next();
  }

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const pass = decoded.slice(decoded.indexOf(":") + 1);
    if (pass === password) return NextResponse.next();
  }
  return new NextResponse("Login required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Realtyniti CRM"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
