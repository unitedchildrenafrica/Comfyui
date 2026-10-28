import { NextResponse, type NextRequest } from "next/server";
import { checkPassword, createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";
import { rateLimit } from "@/lib/server/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Hinter Cloudflare steht die echte IP in cf-connecting-ip
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (!rateLimit(`login:${ip}`)) {
    return NextResponse.json({ error: "Zu viele Versuche. Bitte eine Minute warten." }, { status: 429 });
  }
  if (!process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "APP_PASSWORD ist auf dem Server nicht gesetzt" }, { status: 500 });
  }
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !(await checkPassword(password))) {
    return NextResponse.json({ error: "Falsches Passwort" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
