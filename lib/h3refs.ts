// Referenzen für MiniMax H3 (REF2VA) – Regeln wie in ComfyUI-DaSiWa-Nodes
// (nodes_minimax_h3_director.py, helper validate_reference_limits):
//   höchstens 9 Bilder, 3 Videos, 3 Audios, zusammen 12 Dateien
//   Videos (Bild) zusammen höchstens 15 s, Audio zusammen höchstens 15 s
//   Audio nur zusammen mit einem Bild oder Video (Bild)
// Ein Video kann als Bild, nur als Ton oder als Bild + Ton dienen. Nur-Ton-Videos werden zu
// <Audio n> – und zwar VOR den normalen Audio-Dateien (der Director verarbeitet Videos zuerst).
import type { H3Ref } from "./types";

export const REF_MIN_SECONDS = 2;
export const REF_MAX_SECONDS = 15;
export const REF_TOTAL_SECONDS = 15;
export const REF_MAX_VIDEOS = 3;
export const REF_MAX_AUDIOS = 3;
export const REF_MAX_FILES = 12;
export const REF_MAX_IMAGES = 9;
/** Ref-Tabs: Standard 5, mit „+“ bis 10 */
export const REF_TABS_DEFAULT = 5;
export const REF_TABS_MAX = 10;
/** „Tab Extra“: Zwischenspeicher für „Einstellungen übernehmen“ – Nummer 0, nie im Bereich 1…N */
export const EXTRA_TAB = 0;
/** „Ref-Tab 3“ / „Ref-Tab Extra“ für Meldungen */
export const refTabName = (tab: number) => (tab === EXTRA_TAB ? "Ref-Tab Extra" : `Ref-Tab ${tab}`);
/** kurz für Knöpfe und Listen: „Tab 3“ / „Extra“ */
export const refTabShort = (tab: number) => (tab === EXTRA_TAB ? "Extra" : `Tab ${tab}`);

export type VideoMode = NonNullable<H3Ref["mediaMode"]>;
export const videoMode = (r: H3Ref): VideoMode => r.mediaMode ?? "video";
/** Video liefert Bild an das Modell */
export const videoHasPicture = (r: H3Ref) => r.kind === "video" && videoMode(r) !== "audio";
/** Referenz liefert Ton (Audio-Datei oder Video im Modus Ton / Bild + Ton) */
export const refHasSound = (r: H3Ref) => r.kind === "audio" || (r.kind === "video" && videoMode(r) !== "video");

/** Tatsächlich genutzte Länge nach Start/Ende; null, wenn die Dateilänge unbekannt ist. */
export function usedSeconds(r: Pick<H3Ref, "duration" | "trimStart" | "trimEnd">): number | null {
  const start = r.trimStart ?? 0;
  const end = r.trimEnd ?? r.duration;
  if (end === undefined || !Number.isFinite(end)) return null;
  return Math.max(0, Math.min(end, r.duration ?? end) - start);
}

/** Prompt-Tag(s) einer Referenz, z. B. „<Picture 2>“, „<Video 1>“, „<Audio 1>“ */
export function refTag(refs: H3Ref[], r: H3Ref): string {
  if (r.kind === "image") return `<Picture ${refs.filter((x) => x.kind === "image").indexOf(r) + 1}>`;
  const videos = refs.filter((x) => x.kind === "video");
  if (r.kind === "video" && videoMode(r) !== "audio") return `<Video ${videos.filter(videoHasPicture).indexOf(r) + 1}>`;
  // Nur-Ton-Videos zuerst, dann die Audio-Dateien
  const audioOrder = [...videos.filter((x) => videoMode(x) === "audio"), ...refs.filter((x) => x.kind === "audio")];
  return `<Audio ${audioOrder.indexOf(r) + 1}>`;
}

export function refWarnings(refs: H3Ref[]): string[] {
  const images = refs.filter((r) => r.kind === "image");
  const videos = refs.filter((r) => r.kind === "video");
  const audios = refs.filter((r) => r.kind === "audio");
  const warnings: string[] = [];
  if (videos.length > REF_MAX_VIDEOS) warnings.push(`Höchstens ${REF_MAX_VIDEOS} Video-Referenzen.`);
  const sounds = refs.filter(refHasSound);
  if (sounds.length > REF_MAX_AUDIOS) warnings.push(`Höchstens ${REF_MAX_AUDIOS} Tonspuren (Audios + Videos mit Ton).`);
  if (images.length + videos.length + audios.length > REF_MAX_FILES) warnings.push(`Höchstens ${REF_MAX_FILES} Referenzen insgesamt.`);
  if (sounds.length && !images.length && !videos.some(videoHasPicture)) warnings.push("Ton-Referenzen brauchen mindestens ein Referenzbild oder ein Video (Bild).");

  const trimProblem = (r: H3Ref) => r.trimEnd !== undefined && r.trimEnd <= (r.trimStart ?? 0);
  let soundTotal = 0;
  let videoTotal = 0;
  for (const r of refs) {
    if (r.kind === "image") continue;
    const tag = refTag(refs, r);
    if (trimProblem(r)) {
      warnings.push(`${tag}: Ende muss nach dem Start liegen.`);
      continue;
    }
    const used = usedSeconds(r);
    if (used === null) continue;
    if (videoHasPicture(r)) videoTotal += used;
    if (refHasSound(r)) soundTotal += used;
    if (r.kind === "audio" && used < REF_MIN_SECONDS) warnings.push(`${tag}: nur ${used.toFixed(1)} s – mindestens ${REF_MIN_SECONDS} s nötig.`);
    if (used > REF_MAX_SECONDS) warnings.push(`${tag}: ${used.toFixed(1)} s – höchstens ${REF_MAX_SECONDS} s. Mit Start/Ende kürzen.`);
  }
  if (videoTotal > REF_TOTAL_SECONDS && videos.filter(videoHasPicture).length > 1)
    warnings.push(`Alle Videos zusammen ${videoTotal.toFixed(1)} s – höchstens ${REF_TOTAL_SECONDS} s.`);
  if (soundTotal > REF_TOTAL_SECONDS && sounds.length > 1) warnings.push(`Aller Ton zusammen ${soundTotal.toFixed(1)} s – höchstens ${REF_TOTAL_SECONDS} s.`);
  return warnings;
}

/** Harte Grenzen des Directors – darüber bricht der Job ab. null = alles in Ordnung. */
export function refLimitError(refs: H3Ref[]): string | null {
  const images = refs.filter((r) => r.kind === "image").length;
  const videos = refs.filter((r) => r.kind === "video").length;
  const sounds = refs.filter(refHasSound).length;
  if (images > REF_MAX_IMAGES) return `Höchstens ${REF_MAX_IMAGES} Referenzbilder`;
  if (videos > REF_MAX_VIDEOS) return `Höchstens ${REF_MAX_VIDEOS} Video-Referenzen`;
  if (sounds > REF_MAX_AUDIOS) return `Höchstens ${REF_MAX_AUDIOS} Tonspuren (Audios + Videos mit Ton)`;
  if (refs.length > REF_MAX_FILES) return `Höchstens ${REF_MAX_FILES} Referenzen insgesamt`;
  return null;
}

/** Tags im Prompt („<Picture 3>“), die es in diesen Referenzen nicht gibt */
export function tagWarnings(text: string, refs: H3Ref[]): string[] {
  const count = {
    picture: refs.filter((r) => r.kind === "image").length,
    video: refs.filter(videoHasPicture).length,
    audio: refs.filter((r) => r.kind === "audio" || (r.kind === "video" && videoMode(r) === "audio")).length,
  };
  const out = new Set<string>();
  for (const m of text.matchAll(/<\s*(picture|video|audio)\s+(\d+)\s*>/gi)) {
    const kind = m[1].toLowerCase() as keyof typeof count;
    const n = Number(m[2]);
    if (n > count[kind]) out.add(`<${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${n}>`);
  }
  return [...out];
}
