// Mehrere Pods im Server-Modus: welcher Pod macht Bilder, welcher Videos?
// Reine Logik (ohne Server-Zustand), damit sie sich gut testen lässt.

/** Was auf dem Pod installiert ist – kommt aus dem Setup-Befehl (setup.sh bilder | video | alles) */
export type PodKind = "bilder" | "video" | "alles";
/** Aufgabe in der App */
export type PodRole = "bild" | "video";

export interface PodInfo {
  /** stabile Kennung des Pods (Hostname); „legacy“ für alte Pods ohne Kennung */
  id: string;
  url: string;
  gpu?: string;
  kind: PodKind;
  /** von Hand festgelegte Rolle (Setup-Seite); null = automatisch */
  pin?: PodRole | null;
  registeredAt: number;
  lastSeen: number;
}

/** Pod gilt als verbunden, wenn er sich in den letzten 3 Minuten gemeldet hat (Lebenszeichen jede Minute) */
export const POD_ONLINE_MS = 3 * 60_000;

export const isOnline = (p: PodInfo, now = Date.now()) => now - p.lastSeen < POD_ONLINE_MS;

export const POD_KINDS: PodKind[] = ["bilder", "video", "alles"];
export const toKind = (v: unknown): PodKind => (POD_KINDS.includes(v as PodKind) ? (v as PodKind) : "alles");

/**
 * Rollen verteilen (nur verbundene Pods, ältester zuerst):
 * - Video: festgelegter Video-Pod → Pod mit Setup „video“ → Pod mit „alles“ → irgendein Pod
 * - Bild:  festgelegter Bild-Pod → Pod mit Setup „bilder“ → anderer Pod mit „alles“ → der Video-Pod
 * Ist nur ein Pod da, macht er beides (wie früher).
 */
export function assignRoles(pods: PodInfo[], now = Date.now()): { bild: string | null; video: string | null } {
  const online = pods.filter((p) => isOnline(p, now)).sort((a, b) => a.registeredAt - b.registeredAt || a.id.localeCompare(b.id));
  const pick = (...tests: ((p: PodInfo) => boolean)[]) => {
    for (const t of tests) {
      const hit = online.find(t);
      if (hit) return hit;
    }
    return null;
  };
  const video = pick(
    (p) => p.pin === "video",
    (p) => p.kind === "video" && p.pin !== "bild",
    (p) => p.kind === "alles" && p.pin !== "bild",
    (p) => p.pin !== "bild",
    () => true,
  );
  const bild = pick(
    (p) => p.pin === "bild",
    (p) => p.kind === "bilder" && p.pin !== "video",
    (p) => p.kind === "alles" && p.pin !== "video" && p !== video,
    (p) => p === video,
    () => true,
  );
  return { bild: bild?.id ?? null, video: video?.id ?? null };
}

/** Kennung aus der Anmeldung: nur harmlose Zeichen, sonst „legacy“ (alte Pods ohne Kennung) */
export function cleanPodId(v: unknown): string {
  return typeof v === "string" && /^[\w.-]{1,64}$/.test(v) ? v : "legacy";
}
