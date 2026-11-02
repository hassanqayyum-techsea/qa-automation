import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only (cookie present). Real authorization happens in lib/auth.ts on every request.
export default function proxy(req: NextRequest) {
  if (!req.cookies.has("session")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = {
  // Public: login, GitHub webhooks (HMAC-verified), Next internals and static files.
  matcher: ["/((?!login|api/webhooks|_next/|favicon.ico).*)"],
};
