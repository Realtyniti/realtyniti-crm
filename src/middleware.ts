import { NextResponse, type NextRequest } from "next/server";

/*
 * Chetan-only access. Every screen sits behind one password (ADMIN_PASSWORD).
 * Intake webhooks carry their own secrets and are left open here.
 */
export function middleware(req: NextRequest) {
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
  matcher: ["/((?!api/intake|api/whatsapp|api/cron|book/|privacy|_next/static|_next/image|favicon.ico).*)"],
};
