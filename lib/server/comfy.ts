import { config } from "./config";
import { currentPod, getOnlinePods, podSecret, rememberPromptPod, serverMode, withPod } from "./podLink";

export class ComfyUnavailableError extends Error {
  constructor(cause?: unknown, message = "ComfyUI antwortet nicht") {
    super(message);
    this.cause = cause;
  }
}

/** Header für das Pod-Gateway (nur im Server-Modus). */
export function podHeaders(): Record<string, string> {
  return serverMode() && podSecret() ? { "x-pod-secret": podSecret() } : {};
}

export class ComfyPromptError extends Error {
  constructor(
    message: string,
    public details: { error?: unknown; node_errors?: Record<string, unknown> },
  ) {
    super(message);
  }
}

export async function comfyFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 15_000, ...rest } = init;
  if (serverMode() && !currentPod()) throw new ComfyUnavailableError(undefined, "Kein Pod verbunden");
  const headers = new Headers(rest.headers);
  for (const [k, v] of Object.entries(podHeaders())) headers.set(k, v);
  let res: Response;
  try {
    res = await fetch(config.comfyUrl + path, { ...rest, headers, signal: rest.signal ?? AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (err) {
    throw new ComfyUnavailableError(err);
  }
  // 520–530 = Cloudflare erreicht den Pod-Tunnel nicht (statt einer HTML-Fehlerseite eine klare Meldung)
  if (serverMode() && res.status >= 520 && res.status <= 530) {
    await res.body?.cancel().catch(() => {});
    throw new ComfyUnavailableError(
      undefined,
      `Pod-Tunnel nicht erreichbar (HTTP ${res.status}) – der Pod baut ihn gerade neu auf. In 1–2 Minuten nochmal versuchen.`,
    );
  }
  // 502–504 = Tunnel steht, aber dahinter antwortet nichts (ComfyUI startet neu, ist abgestürzt
  // oder das Gateway auf dem Pod läuft nicht). ComfyUI selbst liefert diese Codes nie.
  if (serverMode() && res.status >= 502 && res.status <= 504) {
    await res.body?.cancel().catch(() => {});
    throw new ComfyUnavailableError(
      undefined,
      `Pod antwortet nicht (HTTP ${res.status}) – ComfyUI startet gerade neu oder ist abgestürzt. Im Pod-Terminal prüfen: tail -20 /workspace/comfy.log`,
    );
  }
  return res;
}

export async function comfyJson<T = unknown>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const res = await comfyFetch(path, init);
  if (!res.ok) throw new Error(`ComfyUI ${path}: HTTP ${res.status} ${await res.text().catch(() => "")}`.slice(0, 500));
  return (await res.json()) as T;
}

export function postJson(path: string, body: unknown, timeoutMs?: number) {
  return comfyFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs,
  });
}

export async function queuePrompt(prompt: unknown, clientId: string): Promise<string> {
  const res = await postJson("/prompt", { prompt, client_id: clientId }, 30_000);
  const data = (await res.json().catch(() => ({}))) as {
    prompt_id?: string;
    error?: { message?: string; details?: string } | string;
    node_errors?: Record<string, unknown>;
  };
  if (!res.ok || !data.prompt_id) {
    const msg = typeof data.error === "string" ? data.error : data.error?.message || `HTTP ${res.status}`;
    throw new ComfyPromptError(msg, { error: data.error, node_errors: data.node_errors });
  }
  // merken, auf welchem Pod der Job liegt (Abbrechen, Vorschau, Galerie)
  if (serverMode()) rememberPromptPod(data.prompt_id, currentPod()?.id);
  return data.prompt_id;
}

// --- /object_info mit kurzem Cache -------------------------------------------------

type ObjectInfo = Record<string, { input?: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> } }>;
const infoCache = new Map<string, { at: number; data: ObjectInfo[string] | null }>();

export async function getNodeInfo(cls: string, maxAgeMs = 30_000) {
  // pro Pod getrennt – Bild- und Video-Pod haben verschiedene Modelle und Nodes
  const key = `${config.comfyUrl}|${cls}`;
  const hit = infoCache.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.data;
  const res = await comfyFetch(`/object_info/${encodeURIComponent(cls)}`);
  if (!res.ok) {
    // z. B. ComfyUI startet gerade neu – nicht als „gibt es nicht“ merken
    await res.body?.cancel().catch(() => {});
    throw new ComfyUnavailableError(undefined, `ComfyUI antwortet nicht (HTTP ${res.status}) – startet es gerade neu?`);
  }
  const json = (await res.json()) as ObjectInfo;
  const data = json[cls] ?? null;
  infoCache.set(key, { at: Date.now(), data });
  return data;
}

export function clearNodeInfoCache() {
  infoCache.clear();
}

/** Liest die Auswahlwerte eines COMBO-Eingangs (altes und neues Format). */
export function comboValues(info: ObjectInfo[string] | null, field: string): string[] {
  const spec = info?.input?.required?.[field] ?? info?.input?.optional?.[field];
  if (!spec) return [];
  if (Array.isArray(spec[0])) return (spec[0] as unknown[]).map(String);
  if (spec[0] === "COMBO" && spec[1] && typeof spec[1] === "object") {
    const opts = (spec[1] as { options?: unknown[] }).options;
    if (Array.isArray(opts)) return opts.map(String);
  }
  return [];
}

export async function nodeExists(cls: string) {
  try {
    return (await getNodeInfo(cls)) !== null;
  } catch {
    return false;
  }
}

/**
 * Server-Modus mit mehreren Pods: eine Datei (z. B. /view) auf dem Pod holen, der sie hat.
 * Bevorzugte Pods zuerst (Pod des Jobs), dann die übrigen verbundenen. Ohne Server-Modus: normal.
 */
export async function fetchFromPods(path: string, init: RequestInit & { timeoutMs?: number } = {}, prefer: (string | null | undefined)[] = []): Promise<Response> {
  if (!serverMode()) return comfyFetch(path, init);
  const online = getOnlinePods().map((p) => p.id);
  const order = [...new Set([...prefer.filter((x): x is string => !!x && online.includes(x)), ...online])];
  if (!order.length) throw new ComfyUnavailableError(undefined, "Kein Pod verbunden");
  let last: Response | null = null;
  let lastErr: unknown = null;
  for (const id of order) {
    try {
      const res = await withPod(id, () => comfyFetch(path, init));
      if (res.ok || res.status === 206) return res;
      await last?.body?.cancel().catch(() => {});
      last = res;
    } catch (err) {
      lastErr = err;
    }
  }
  if (last) return last;
  throw lastErr;
}
