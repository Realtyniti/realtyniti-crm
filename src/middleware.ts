import { NextResponse, type NextRequest } from "next/server";
import { isReadOnly } from "@/lib/read-only";

/**
 * Open without signing in: webhooks and cron carry their own secrets; buyers open booking links;
 * the sign-in, invite and privacy pages; and the files a phone needs to install the app.
 */
const PUBLIC = /^\/(api\/intake|api\/whatsapp|api\/cron|book\/|privacy|login|join\/|sw\.js$|manifest\.webmanifest$|offline\.html$|icons\/|apple-touch-icon)/;

/** Same name as SESSION_COOKIE in lib/auth/session.ts (that module is server-only, so not imported here). */
const SESSION_COOKIE = "rn_session";

/*
 * Every CRM screen needs a personal login. This only checks that a session cookie is present,
 * which keeps the edge fast; every page, server action and admin API route then checks the
 * session against the database (lib/auth/session.ts), so a deactivated login stops working on
 * its very next request.
 */
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // A read-only preview serves screens only: no webhooks, cron or admin calls that could write or message anyone.
  if (isReadOnly() && path.startsWith("/api/")) {
    return new NextResponse("Read-only preview: API routes are switched off.", { status: 403 });
  }
  if (PUBLIC.test(path)) return NextResponse.next();

  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  if (path.startsWith("/api/")) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const login = new URL("/login", req.url);
  if (path !== "/") login.searchParams.set("next", path + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
