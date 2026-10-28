import { config } from "./config";

export class ComfyUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("ComfyUI antwortet nicht");
    this.cause = cause;
  }
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
  try {
    return await fetch(config.comfyUrl + path, { ...rest, signal: rest.signal ?? AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (err) {
    throw new ComfyUnavailableError(err);
  }
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
  return data.prompt_id;
}

// --- /object_info mit kurzem Cache -------------------------------------------------

type ObjectInfo = Record<string, { input?: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> } }>;
const infoCache = new Map<string, { at: number; data: ObjectInfo[string] | null }>();

export async function getNodeInfo(cls: string, maxAgeMs = 30_000) {
  const hit = infoCache.get(cls);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.data;
  const res = await comfyFetch(`/object_info/${encodeURIComponent(cls)}`);
  const json = res.ok ? ((await res.json()) as ObjectInfo) : {};
  const data = json[cls] ?? null;
  infoCache.set(cls, { at: Date.now(), data });
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
