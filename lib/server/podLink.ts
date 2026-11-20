import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type PodInfo, type PodKind, type PodRole, assignRoles, isOnline } from "../podRoles";

// Server-Modus: Die App läuft dauerhaft auf einem eigenen Server (z. B. one.com) und spricht
// über ein Gateway auf den GPU-Pods mit ComfyUI. Jeder Pod meldet sich per /api/pod/register an.
// Es können mehrere Pods gleichzeitig laufen – einer macht Bilder, einer Videos (siehe podRoles).

export type { PodInfo };
/** Rückwärtskompatibel: „der“ Pod */
export type PodLink = PodInfo;

interface Registry {
  pods: PodInfo[];
  loaded: boolean;
  listeners: Set<(podId: string) => void>;
}

const g = globalThis as unknown as { __pods?: Registry };
const reg = (): Registry => (g.__pods ??= { pods: [], loaded: false, listeners: new Set() });

export function serverMode(): boolean {
  return process.env.SERVER_MODE === "1";
}

export function podSecret(): string {
  return process.env.POD_SECRET || "";
}

const dataDir = () => process.env.DATA_DIR || "/workspace/pod-frontend-data";
const file = () => path.join(dataDir(), "pods.json");
const legacyFile = () => path.join(dataDir(), "pod.json");

function load(): Registry {
  const r = reg();
  if (r.loaded) return r;
  r.loaded = true;
  try {
    r.pods = (JSON.parse(readFileSync(file(), "utf8")) as { pods?: PodInfo[] }).pods ?? [];
  } catch {
    // Umstieg: früher gab es nur einen Pod in pod.json
    try {
      const old = JSON.parse(readFileSync(legacyFile(), "utf8")) as { url: string; gpu?: string; registeredAt: number; lastSeen: number };
      if (old?.url) r.pods = [{ id: "legacy", kind: "alles", pin: null, ...old }];
    } catch {}
  }
  return r;
}

async function persist() {
  await fs.mkdir(dataDir(), { recursive: true });
  const tmp = `${file()}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ pods: load().pods }));
  await fs.rename(tmp, file());
}

const notify = (podId: string) => {
  for (const fn of reg().listeners) fn(podId);
};

export function getPods(): PodInfo[] {
  return load().pods;
}

export function getPod(id: string | null | undefined): PodInfo | null {
  return id ? (load().pods.find((p) => p.id === id) ?? null) : null;
}

export function getOnlinePods(): PodInfo[] {
  return load().pods.filter((p) => isOnline(p));
}

/** Anmeldung bzw. Lebenszeichen eines Pods. changed = neu oder neue Tunnel-Adresse. */
export async function registerPod(input: { id: string; url: string; gpu?: string; kind: PodKind }) {
  const r = load();
  const now = Date.now();
  const prev = r.pods.find((p) => p.id === input.id);
  const changed = !prev || prev.url !== input.url;
  const pod: PodInfo = {
    id: input.id,
    url: input.url,
    gpu: input.gpu ?? prev?.gpu,
    kind: input.kind,
    pin: prev?.pin ?? null,
    // neue Adresse = Pod/Tunnel neu gestartet; die Reihenfolge (wer war zuerst da) bleibt
    registeredAt: prev?.registeredAt ?? now,
    lastSeen: now,
  };
  // Pods werden hier nie wegen eines späten Lebenszeichens entfernt: Das kommt nur ungefähr jede
  // Minute (60 s Pause + Selbsttest der Tunnel-Adresse). Ein Entfernen ließ die Rollen springen und
  // schickte Jobs an den falschen Pod. Getrennt gilt ein Pod erst nach 3 Minuten (isOnline).
  r.pods = [...r.pods.filter((p) => p !== prev), pod];
  // Lange getrennte Pods aufräumen (nach einem Tag)
  r.pods = r.pods.filter((p) => p === pod || now - p.lastSeen < 24 * 3600_000);
  await persist();
  if (changed) notify(pod.id);
  return { changed, pod };
}

export async function setPodPin(id: string, pin: PodRole | null) {
  const p = getPod(id);
  if (!p) return false;
  p.pin = pin;
  await persist();
  notify(id);
  return true;
}

export async function removePod(id: string) {
  const r = load();
  r.pods = r.pods.filter((p) => p.id !== id);
  await persist();
  notify(id);
}

/** Wird aufgerufen, wenn ein Pod dazukommt, seine Adresse wechselt oder er entfernt wird. */
export function onPodChange(fn: (podId: string) => void) {
  reg().listeners.add(fn);
}

export function podOnline(link: PodInfo | null | undefined): boolean {
  return !!link && isOnline(link);
}

/** Aktuelle Rollenverteilung (Pod-Kennungen) */
export function podRoles() {
  return assignRoles(load().pods);
}

/** Pod für eine Aufgabe (Bild/Video) – bei nur einem Pod derselbe */
export function podFor(role: PodRole): PodInfo | null {
  return getPod(podRoles()[role]);
}

/** Rückwärtskompatibel: „der“ Pod = Video-Pod, sonst Bild-Pod, sonst der zuletzt gesehene */
export function getPodLink(): PodInfo | null {
  const roles = podRoles();
  return getPod(roles.video) ?? getPod(roles.bild) ?? [...load().pods].sort((a, b) => b.lastSeen - a.lastSeen)[0] ?? null;
}

// --- Welcher Pod ist für den laufenden Code gemeint? ------------------------------------------
// Statt jede Funktion um einen Pod-Parameter zu erweitern, läuft der Code in einem Pod-Kontext:
// withPod("abc", () => comfyFetch(...)) spricht mit Pod „abc“. Ohne Kontext gilt getPodLink().

const ctx = new AsyncLocalStorage<string | null>();

export function withPod<T>(podId: string | null, fn: () => T): T {
  return ctx.run(podId, fn);
}

export function withRole<T>(role: PodRole, fn: () => T): T {
  return withPod(serverMode() ? (podFor(role)?.id ?? null) : null, fn);
}

/** Pod des laufenden Kontexts (null = keiner verbunden) */
export function currentPod(): PodInfo | null {
  const id = ctx.getStore();
  if (id !== undefined) return getPod(id);
  return getPodLink();
}

/** Für jeden verbundenen Pod ausführen; Fehler einzelner Pods werden gesammelt statt geworfen. */
export async function forEachPod<T>(fn: (pod: PodInfo) => Promise<T>): Promise<{ pod: PodInfo; value?: T; error?: unknown }[]> {
  const pods = getOnlinePods();
  return Promise.all(
    pods.map((pod) =>
      withPod(pod.id, () =>
        fn(pod).then(
          (value) => ({ pod, value }),
          (error: unknown) => ({ pod, error }),
        ),
      ),
    ),
  );
}

// --- Welcher Job läuft auf welchem Pod? --------------------------------------------------------

const gj = globalThis as unknown as { __promptPods?: Map<string, string> };
const promptPods = () => (gj.__promptPods ??= new Map());

export function rememberPromptPod(promptId: string, podId: string | null | undefined) {
  if (!podId) return;
  const m = promptPods();
  m.set(promptId, podId);
  while (m.size > 20_000) m.delete(m.keys().next().value!);
}

export function promptPodId(promptId: string): string | null {
  return promptPods().get(promptId) ?? null;
}
