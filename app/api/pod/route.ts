import { getPodLink, podOnline, serverMode } from "@/lib/server/podLink";

export const dynamic = "force-dynamic";

/** Zustand der Pod-Verbindung für die Einstellungsseite. */
export function GET() {
  const link = getPodLink();
  return Response.json({ serverMode: serverMode(), link, online: serverMode() ? podOnline(link) : true });
}
