// Video-Batch: viele H3-Prompts auf einmal, jeder wird ein eigener Job (wie beim Bild-Batch).

import type { BatchError } from "./batch";
import { buildH3Prompt, checkH3Prompt, hasBlockHeading, isClipLine, parseDurationLine, parseH3Prompt, parseRefTabLine, splitClipName } from "./h3prompt";
import { EXTRA_TAB, refLimitError, refTabName, tagWarnings } from "./h3refs";
import type { H3Blocks, H3Ref, H3Settings } from "./types";

export interface VideoBatchItem {
  /** Nummer des Abschnitts im Text (1-basiert) */
  block: number;
  /** Clip-Name aus der ersten Zeile, leer = Datei nach Uhrzeit */
  name: string;
  /** REF2VA: erkannte Blöcke */
  blocks: H3Blocks | null;
  /** andere Modi: Freitext */
  text: string;
  /** kurze Vorschau für die Liste */
  preview: string;
  warnings: string[];
  /** Ref-Tab dieses Clips (1-basiert, 0 = Tab Extra); null = ohne Tabs (altes Formular) */
  refTab: number | null;
  /** Referenzen aus diesem Tab; null = Formular-Referenzen */
  refs: H3Ref[] | null;
  /** Dauer in Sekunden aus einer Zeile „Dauer 8“; null = Dauer aus dem Formular */
  duration: number | null;
}

/** Erlaubte Dauer pro Clip (wie der Regler) */
export const CLIP_MIN_SECONDS = 2;
export const CLIP_MAX_SECONDS = 15;

/** Kopfzeile über dem Prompt, die kein Clip-Name ist: „Ref-Tab 3“ oder „Dauer 8“ */
const isHeaderLine = (line: string) => parseRefTabLine(line) !== null || parseDurationLine(line) !== null;

export const VIDEO_BATCH_MAX = 300;

/**
 * Trennt den Text in einzelne Clips:
 *   - an Zeilen mit nur „---“ (so trennt Claude ohnehin gern)
 *   - oder, wenn keine „---“ da sind, vor jeder Zeile wie „Clip 35“
 * Code-Zäune (```) werden ignoriert. Abschnitte ohne Prompt (z. B. „Hier sind deine Prompts:“)
 * werden übersprungen und in `skipped` gemeldet.
 */
export function splitVideoBatch(raw: string): string[] {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => !/^\s*```[\w-]*\s*$/.test(l));
  const chunks: string[][] = [[]];
  for (const line of lines) {
    if (/^\s*-{3,}\s*$/.test(line) || /^\s*\*{3,}\s*$/.test(line)) chunks.push([]);
    else chunks[chunks.length - 1].push(line);
  }
  // Innerhalb eines Abschnitts mehrere „Clip N“-Zeilen → dort zusätzlich trennen
  const out: string[] = [];
  for (const chunk of chunks) {
    const clipLines = chunk.filter(isClipLine).length;
    if (clipLines < 2) {
      out.push(chunk.join("\n"));
      continue;
    }
    let cur: string[] = [];
    for (const line of chunk) {
      if (isClipLine(line) && cur.some((l) => l.trim())) {
        // „Ref-Tab 3“ / „Dauer 8“ direkt über „Clip 35“ gehören zum neuen Clip
        let start = cur.length;
        for (let k = cur.length - 1; k >= 0; k--) {
          if (!cur[k].trim()) continue;
          if (!isHeaderLine(cur[k])) break;
          start = k;
        }
        const carry = cur.splice(start);
        if (cur.some((l) => l.trim())) out.push(cur.join("\n"));
        cur = carry;
      }
      cur.push(line);
    }
    out.push(cur.join("\n"));
  }
  return out.filter((c) => c.trim());
}

/** Kopfzeilen „Ref-Tab 3“ / „Dauer 8“ oben im Abschnitt abtrennen (beliebige Reihenfolge) */
function takeHeaders(text: string, into: { tab: number | null; duration: number | null }): string {
  const lines = text.split("\n");
  let i = 0;
  for (; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const tab = parseRefTabLine(lines[i]);
    const duration = tab === null ? parseDurationLine(lines[i]) : null;
    if (tab !== null) into.tab ??= tab;
    else if (duration !== null) into.duration ??= duration;
    else break;
  }
  return lines.slice(i).join("\n");
}

export function parseVideoBatch(
  raw: string,
  opts: {
    mode: string;
    noDialogue: boolean;
    /** alle Ref-Tabs; ohne = kein Wechsel pro Clip */
    tabs?: H3Ref[][];
    /** „Tab Extra“ (aus „Einstellungen übernehmen“), falls vorhanden */
    extra?: H3Ref[] | null;
    /** Tab für Clips ohne Ref-Tab-Zeile (1-basiert, 0 = Tab Extra) */
    defaultTab?: number;
  },
): { items: VideoBatchItem[]; errors: BatchError[]; skipped: string[] } {
  const items: VideoBatchItem[] = [];
  const errors: BatchError[] = [];
  const skipped: string[] = [];
  const isRef = opts.mode === "REF2VA";
  splitVideoBatch(raw).forEach((chunk, i) => {
    const block = i + 1;
    // Reihenfolge egal: „Ref-Tab 3“ / „Dauer 8“ über oder unter „Clip 35“
    const head: { tab: number | null; duration: number | null } = { tab: null, duration: null };
    const clip = splitClipName(takeHeaders(chunk, head));
    const name = clip.name;
    const text = takeHeaders(clip.text, head).trim();
    const wanted = head.tab;
    const label = name ? `„${name}“: ` : "";
    if (head.duration !== null && (head.duration < CLIP_MIN_SECONDS || head.duration > CLIP_MAX_SECONDS)) {
      if (hasBlockHeading(text) || !isRef) errors.push({ block, message: `${label}Dauer ${head.duration} s – erlaubt sind ${CLIP_MIN_SECONDS}–${CLIP_MAX_SECONDS} s` });
      return;
    }
    let refTab: number | null = null;
    let refs: H3Ref[] | null = null;
    const refNotes: string[] = [];
    if (opts.tabs) {
      refTab = wanted ?? opts.defaultTab ?? 1;
      const tabRefs = refTab === EXTRA_TAB ? opts.extra : opts.tabs[refTab - 1];
      if (!tabRefs) {
        const why = refTab === EXTRA_TAB ? "Ref-Tab Extra gibt es gerade nicht (entsteht bei „Einstellungen übernehmen“)" : `Ref-Tab ${refTab} gibt es nicht (nur 1–${opts.tabs.length})`;
        if (hasBlockHeading(text) || !isRef) errors.push({ block, message: `${label}${why}` });
        return;
      }
      refs = tabRefs;
      const limit = refLimitError(tabRefs);
      if (limit && isRef) {
        errors.push({ block, message: `${label}${refTabName(refTab)}: ${limit}` });
        return;
      }
      if (isRef && !tabRefs.length) refNotes.push(`${refTabName(refTab)} ist leer`);
      const missingTags = tagWarnings(text, tabRefs);
      if (missingTags.length) refNotes.push(`${missingTags.join(", ")} gibt es in ${refTabName(refTab)} nicht`);
    } else if (wanted !== null) {
      refNotes.push(`„${refTabName(wanted)}“ ignoriert – keine Ref-Tabs geladen`);
    }
    if (isRef) {
      if (!hasBlockHeading(text)) {
        // Einleitung/Schluss von Claude ohne Prompt → überspringen, aber anzeigen
        skipped.push((name || text).trim().split("\n")[0].slice(0, 60));
        return;
      }
      const blocks = parseH3Prompt(text);
      if (!blocks) {
        errors.push({ block, message: `${name ? `„${name}“: ` : ""}Blöcke nicht erkannt (Text vor dem ersten Block oder Block doppelt)` });
        return;
      }
      const full = buildH3Prompt(blocks);
      items.push({
        block,
        name,
        blocks,
        text: "",
        preview: (blocks.summary || blocks.detailed_description).replace(/\s+/g, " ").slice(0, 90),
        warnings: [...refNotes, ...checkH3Prompt(full, blocks.overall_soundscape, opts.noDialogue)],
        refTab,
        refs,
        duration: head.duration,
      });
    } else {
      if (!text.trim()) return;
      items.push({
        block,
        name,
        blocks: null,
        text,
        preview: text.replace(/\s+/g, " ").trim().slice(0, 90),
        warnings: [...refNotes, ...checkH3Prompt(text, text, opts.noDialogue)],
        refTab,
        refs,
        duration: head.duration,
      });
    }
  });
  if (items.length > VIDEO_BATCH_MAX) errors.push({ block: 0, message: `Höchstens ${VIDEO_BATCH_MAX} Clips pro Batch` });
  return { items, errors, skipped };
}

/** Einstellungen für einen einzelnen Clip des Batches (so wird er auch gespeichert → „nochmal“ geht) */
export function settingsForItem(s: H3Settings, item: VideoBatchItem): H3Settings {
  const { batchText: _b, refTabs: _t, refExtra: _e, ...base } = s;
  const withRefs = item.refs ? { ...base, refs: item.refs, refTab: item.refTab ?? base.refTab } : base;
  const rest = item.duration !== null ? { ...withRefs, duration: item.duration } : withRefs;
  return item.blocks
    ? { ...rest, promptInput: "blocks", blocks: item.blocks, fullPrompt: "", clipName: item.name }
    : { ...rest, promptInput: "full", fullPrompt: item.text, clipName: item.name };
}
