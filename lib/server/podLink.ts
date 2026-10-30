import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

// Server-Modus: Die App läuft dauerhaft auf einem eigenen Server (z. B. one.com) und spricht
// über ein Gateway auf dem GPU-Pod mit ComfyUI. Der Pod meldet sich per /api/pod/register an.

export interface PodLink {
  /** Basis-URL des Pod-Gateways, z. B. https://xyz.trycloudflare.com */
  url: string;
  gpu?: string;
  registeredAt: number;
  lastSeen: number;
}

const g = globalThis as unknown as { __podLink?: PodLink | null; __podLinkLoaded?: boolean; __podLinkListeners?: Set<() => void> };

export function serverMode(): boolean {
  return process.env.SERVER_MODE === "1";
}

export function podSecret(): string {
  return process.env.POD_SECRET || "";
}

function file() {
  return path.join(process.env.DATA_DIR || "/workspace/pod-frontend-data", "pod.json");
}

export function getPodLink(): PodLink | null {
  if (!g.__podLinkLoaded) {
    g.__podLinkLoaded = true;
    try {
      g.__podLink = JSON.parse(readFileSync(file(), "utf8"));
    } catch {
      g.__podLink = null;
    }
  }
  return g.__podLink ?? null;
}

export async function setPodLink(url: string, gpu?: string) {
  const prev = getPodLink();
  const now = Date.now();
  const changed = prev?.url !== url;
  g.__podLink = { url, gpu, registeredAt: changed || !prev ? now : prev.registeredAt, lastSeen: now };
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(g.__podLink));
  if (changed) for (const fn of g.__podLinkListeners ?? []) fn();
  return { changed };
}

export async function clearPodLink() {
  g.__podLink = null;
  await fs.rm(file(), { force: true });
  for (const fn of g.__podLinkListeners ?? []) fn();
}

/** Wird aufgerufen, wenn sich die Pod-Adresse ändert (z. B. WebSocket neu verbinden). */
export function onPodChange(fn: () => void) {
  (g.__podLinkListeners ??= new Set()).add(fn);
}

/** Pod gilt als verbunden, wenn er sich in den letzten 3 Minuten gemeldet hat. */
export function podOnline(link = getPodLink()): boolean {
  return !!link && Date.now() - link.lastSeen < 3 * 60_000;
}
