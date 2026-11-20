import type { NextRequest } from "next/server";
import { clearNodeInfoCache } from "@/lib/server/comfy";
import { getLiveState } from "@/lib/server/events";
import { badRequest } from "@/lib/server/http";
import { getPodLink, getPods, podOnline, podRoles, removePod, serverMode, setPodPin } from "@/lib/server/podLink";

export const dynamic = "force-dynamic";

/** Zustand der Pod-Verbindung(en) für Setup-Seite und „Modelle laden“. */
export function GET() {
  const link = getPodLink();
  const live = getLiveState();
  const roles = podRoles();
  const pods = getPods()
    .map((p) => {
      const l = live.pods.find((x) => x.podId === p.id);
      return {
        id: p.id,
        gpu: p.gpu ?? null,
        kind: p.kind,
        pin: p.pin ?? null,
        online: podOnline(p),
        roles: (["bild", "video"] as const).filter((r) => roles[r] === p.id),
        registeredAt: p.registeredAt,
        lastSeen: p.lastSeen,
        live: { connected: l?.connected ?? false, error: l?.linkError ?? null },
      };
    })
    .sort((a, b) => Number(b.online) - Number(a.online) || a.registeredAt - b.registeredAt);
  return Response.json({
    serverMode: serverMode(),
    pods,
    roles,
    // für ältere Anzeigen: „der“ Pod
    link,
    online: serverMode() ? podOnline(link) : true,
    // Live-Verbindung (Fortschritt + Vorschau) zu ComfyUI
    live: { connected: live.connected, error: live.linkError },
  });
}

/** { action: "pin", id, role: "bild" | "video" | null } | { action: "remove", id } */
export async function POST(req: NextRequest) {
  if (!serverMode()) return badRequest("Nur im Server-Modus");
  const body = (await req.json().catch(() => ({}))) as { action?: string; id?: string; role?: string | null };
  if (!body.id) return badRequest("id fehlt");
  if (body.action === "pin") {
    const role = body.role === "bild" || body.role === "video" ? body.role : null;
    if (!(await setPodPin(body.id, role))) return badRequest("Pod nicht gefunden");
  } else if (body.action === "remove") {
    await removePod(body.id);
  } else return badRequest("Unbekannte Aktion");
  clearNodeInfoCache();
  return GET();
}
