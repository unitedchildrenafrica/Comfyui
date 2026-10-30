import type { NextRequest } from "next/server";
import { getPodLink, podSecret } from "./podLink";

/**
 * Server-Modus: Anfragen, die auf dem Pod selbst laufen müssen (z. B. „Modelle laden“ – die
 * Dateien gehören auf den Pod), an die App auf dem Pod weiterreichen. Das Gateway leitet
 * /_app/… an sie weiter, das Pod-Geheimnis ersetzt dort den Login.
 */
export async function forwardToPodApp(req: NextRequest, apiPath: string): Promise<Response> {
  const link = getPodLink();
  if (!link) return Response.json({ error: "Kein Pod verbunden – erst einen Pod starten." }, { status: 503 });
  const url = `${link.url}/_app${apiPath}${req.nextUrl.search}`;
  const headers: Record<string, string> = { "x-pod-secret": podSecret() };
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;
  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
  } catch {
    return Response.json({ error: "Pod antwortet nicht" }, { status: 503 });
  }
}
