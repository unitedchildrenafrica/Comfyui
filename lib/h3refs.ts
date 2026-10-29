// Grenzen für REF2VA-Audio laut ComfyUI-DaSiWa-Nodes (validate_reference_limits):
// jede Referenz 2–15 s, alle zusammen höchstens 15 s, Audio nur zusammen mit einem Bild.
import type { H3Ref } from "./types";

export const REF_MIN_SECONDS = 2;
export const REF_MAX_SECONDS = 15;
export const REF_TOTAL_SECONDS = 15;

/** Tatsächlich genutzte Länge nach Start/Ende; null, wenn die Dateilänge unbekannt ist. */
export function usedSeconds(r: Pick<H3Ref, "duration" | "trimStart" | "trimEnd">): number | null {
  const start = r.trimStart ?? 0;
  const end = r.trimEnd ?? r.duration;
  if (end === undefined || !Number.isFinite(end)) return null;
  return Math.max(0, Math.min(end, r.duration ?? end) - start);
}

export function audioRefWarnings(refs: H3Ref[]): string[] {
  const audios = refs.filter((r) => r.kind === "audio");
  if (!audios.length) return [];
  const warnings: string[] = [];
  if (!refs.some((r) => r.kind === "image")) warnings.push("Audio-Referenzen brauchen mindestens ein Referenzbild.");
  let total = 0;
  audios.forEach((r, i) => {
    const tag = `<Audio ${i + 1}>`;
    if (r.trimEnd !== undefined && r.trimEnd <= (r.trimStart ?? 0)) {
      warnings.push(`${tag}: Ende muss nach dem Start liegen.`);
      return;
    }
    const used = usedSeconds(r);
    if (used === null) return;
    total += used;
    if (used < REF_MIN_SECONDS) warnings.push(`${tag}: nur ${used.toFixed(1)} s – mindestens ${REF_MIN_SECONDS} s nötig.`);
    if (used > REF_MAX_SECONDS) warnings.push(`${tag}: ${used.toFixed(1)} s – höchstens ${REF_MAX_SECONDS} s. Mit Start/Ende kürzen.`);
  });
  if (total > REF_TOTAL_SECONDS && audios.length > 1)
    warnings.push(`Alle Audios zusammen ${total.toFixed(1)} s – höchstens ${REF_TOTAL_SECONDS} s.`);
  return warnings;
}
