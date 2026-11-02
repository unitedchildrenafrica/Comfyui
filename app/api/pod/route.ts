import { getLiveState } from "@/lib/server/events";
import { getPodLink, podOnline, serverMode } from "@/lib/server/podLink";

export const dynamic = "force-dynamic";

/** Zustand der Pod-Verbindung für die Einstellungsseite. */
export function GET() {
  const link = getPodLink();
  const live = getLiveState();
  return Response.json({
    serverMode: serverMode(),
    link,
    online: serverMode() ? podOnline(link) : true,
    // Live-Verbindung (Fortschritt + Vorschau) zu ComfyUI
    live: { connected: live.connected, error: live.linkError },
  });
}
