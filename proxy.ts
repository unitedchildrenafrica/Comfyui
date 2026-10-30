import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// /api/pod/register prüft selbst das Pod-Geheimnis
const PUBLIC = ["/login", "/api/auth/login", "/api/health", "/api/pod/register", "/manifest.webmanifest", "/icon.svg"];

function samePodSecret(header: string | null): boolean {
  const secret = process.env.POD_SECRET;
  if (!secret || !header || header.length !== secret.length) return false;
  let d = 0;
  for (let i = 0; i < secret.length; i++) d |= secret.charCodeAt(i) ^ header.charCodeAt(i);
  return d === 0;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.includes(pathname) || pathname.startsWith("/icons/")) return NextResponse.next();
  if (await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  // App auf dem Pod: der Server leitet z. B. „Modelle laden“ mit dem Pod-Geheimnis weiter
  if (samePodSecret(req.headers.get("x-pod-secret"))) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
