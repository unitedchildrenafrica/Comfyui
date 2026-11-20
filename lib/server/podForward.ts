import type { NextRequest } from "next/server";
import { getOnlinePods, getPod, getPodLink, podSecret } from "./podLink";

/**
 * Server-Modus: Anfragen, die auf dem Pod selbst laufen müssen (z. B. „Modelle laden“ – die
 * Dateien gehören auf den Pod), an die App auf dem Pod weiterreichen. Das Gateway leitet
 * /_app/… an sie weiter, das Pod-Geheimnis ersetzt dort den Login.
 */
export async function forwardToPodApp(req: NextRequest, apiPath: string, body?: string, podId?: string | null): Promise<Response> {
  // ?pod=… wählt bei mehreren Pods das Ziel, sonst der Standard-Pod
  const link = getPod(podId ?? req.nextUrl.searchParams.get("pod")) ?? getPodLink();
  if (!link) return Response.json({ error: "Kein Pod verbunden – erst einen Pod starten." }, { status: 503 });
  const url = `${link.url}/_app${apiPath}${req.nextUrl.search}`;
  const headers: Record<string, string> = { "x-pod-secret": podSecret() };
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;
  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : (body ?? (await req.arrayBuffer())),
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
  } catch {
    return Response.json({ error: "Pod antwortet nicht" }, { status: 503 });
  }
}

/**
 * Liste der Downloads aller verbundenen Pods zusammenführen (jeder Eintrag mit „pod“), damit man auf
 * „Modelle laden“ sieht, was auf welchem Pod läuft.
 */
export async function downloadsOfAllPods(req: NextRequest): Promise<Response> {
  const pods = getOnlinePods();
  if (pods.length <= 1) return forwardToPodApp(req, "/api/models/downloads", undefined, pods[0]?.id);
  const parts = await Promise.all(
    pods.map(async (p) => {
      try {
        const res = await forwardToPodApp(req, "/api/models/downloads", undefined, p.id);
        const data = (await res.json()) as { downloads?: Record<string, unknown>[] };
        return (data.downloads ?? []).map((d) => ({ ...d, pod: p.id }));
      } catch {
        return [];
      }
    }),
  );
  return Response.json({ downloads: parts.flat() });
}
