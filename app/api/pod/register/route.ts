import type { NextRequest } from "next/server";
import { clearNodeInfoCache } from "@/lib/server/comfy";
import { cleanPodId, toKind } from "@/lib/podRoles";
import { podSecret, registerPod, serverMode } from "@/lib/server/podLink";

export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Der GPU-Pod meldet sich hier an (und danach jede Minute als Lebenszeichen).
 * POST { url, gpu, id?, kind? } mit Header x-pod-secret. Ohne Login, aber nur mit dem Geheimnis.
 * id = stabile Kennung des Pods (mehrere Pods gleichzeitig), kind = Setup „bilder“ | „video“ | „alles“.
 * Alte Pods schicken beides nicht – sie zählen als ein Pod „alles“.
 */
export async function POST(req: NextRequest) {
  if (!serverMode()) return Response.json({ error: "Nicht im Server-Modus" }, { status: 404 });
  if (!podSecret() || !safeEqual(req.headers.get("x-pod-secret") ?? "", podSecret())) {
    return Response.json({ error: "Falsches Pod-Geheimnis" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { url?: string; gpu?: string; id?: unknown; kind?: unknown };
  const url = body.url;
  if (!url || !/^https?:\/\/[^\s/]+/.test(url)) return Response.json({ error: "url fehlt" }, { status: 400 });
  const { changed, pod } = await registerPod({
    id: cleanPodId(body.id),
    url: url.replace(/\/$/, ""),
    gpu: typeof body.gpu === "string" ? body.gpu.slice(0, 120) : undefined,
    kind: toKind(body.kind),
  });
  if (changed) clearNodeInfoCache();
  return Response.json({ ok: true, changed, id: pod.id });
}
