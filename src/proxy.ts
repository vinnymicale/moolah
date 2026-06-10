import { NextResponse, type NextRequest } from "next/server";

const DEMO_MODE = process.env.DEMO_MODE === "true";

// Routes that are blocked entirely in demo mode
const DEMO_BLOCKED = [
  "/api/plaid/",
  "/api/chat",
  "/api/backup",
  "/api/export/",
  "/api/auth/auto-signin",
  "/welcome",
];

export function proxy(req: NextRequest) {
  if (!DEMO_MODE) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Block routes that require real DB access or expose sensitive data
  const blocked = DEMO_BLOCKED.some((prefix) => pathname.startsWith(prefix));
  if (blocked) {
    return NextResponse.json({ error: "Not available in demo mode." }, { status: 403 });
  }

  // Redirect sign-in to home — demo needs no auth
  if (pathname.startsWith("/signin")) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/signin",
    "/welcome",
  ],
};
