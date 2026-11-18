// Video-Batch: viele H3-Prompts auf einmal, jeder wird ein eigener Job (wie beim Bild-Batch).

import type { BatchError } from "./batch";
import { buildH3Prompt, checkH3Prompt, hasBlockHeading, isClipLine, parseH3Prompt, parseRefTabLine, splitClipName } from "./h3prompt";
import { refLimitError, tagWarnings } from "./h3refs";
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
  /** Ref-Tab dieses Clips (1-basiert); null = ohne Tabs (altes Formular) */
  refTab: number | null;
  /** Referenzen aus diesem Tab; null = Formular-Referenzen */
  refs: H3Ref[] | null;
}

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
        // „Ref-Tab 3“ direkt über „Clip 35“ gehört zum neuen Clip
        const last = cur.findLastIndex((l) => l.trim());
        const carry = parseRefTabLine(cur[last]) !== null ? cur.splice(last) : [];
        if (cur.some((l) => l.trim())) out.push(cur.join("\n"));
        cur = carry;
      }
      cur.push(line);
    }
    out.push(cur.join("\n"));
  }
  return out.filter((c) => c.trim());
}

/** Ref-Tab-Zeile oben im Abschnitt (vor oder nach der Clip-Zeile) abtrennen */
function takeRefTabLine(text: string): { tab: number | null; text: string } {
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.trim());
  const tab = first >= 0 ? parseRefTabLine(lines[first]) : null;
  return tab === null ? { tab, text } : { tab, text: lines.slice(first + 1).join("\n") };
}

export function parseVideoBatch(
  raw: string,
  opts: {
    mode: string;
    noDialogue: boolean;
    /** alle Ref-Tabs; ohne = kein Wechsel pro Clip */
    tabs?: H3Ref[][];
    /** Tab für Clips ohne Ref-Tab-Zeile (1-basiert) */
    defaultTab?: number;
  },
): { items: VideoBatchItem[]; errors: BatchError[]; skipped: string[] } {
  const items: VideoBatchItem[] = [];
  const errors: BatchError[] = [];
  const skipped: string[] = [];
  const isRef = opts.mode === "REF2VA";
  splitVideoBatch(raw).forEach((chunk, i) => {
    const block = i + 1;
    // Reihenfolge egal: „Ref-Tab 3“ über oder unter „Clip 35“
    const before = takeRefTabLine(chunk);
    const clip = splitClipName(before.text);
    const after = before.tab === null ? takeRefTabLine(clip.text) : { tab: null, text: clip.text };
    const name = clip.name;
    const text = after.text.trim();
    const wanted = before.tab ?? after.tab;
    let refTab: number | null = null;
    let refs: H3Ref[] | null = null;
    const refNotes: string[] = [];
    if (opts.tabs) {
      refTab = wanted ?? opts.defaultTab ?? 1;
      const tabRefs = opts.tabs[refTab - 1];
      if (!tabRefs) {
        if (hasBlockHeading(text) || !isRef) errors.push({ block, message: `${name ? `„${name}“: ` : ""}Ref-Tab ${refTab} gibt es nicht (nur 1–${opts.tabs.length})` });
        return;
      }
      refs = tabRefs;
      const limit = refLimitError(tabRefs);
      if (limit && isRef) {
        errors.push({ block, message: `${name ? `„${name}“: ` : ""}Ref-Tab ${refTab}: ${limit}` });
        return;
      }
      if (isRef && !tabRefs.length) refNotes.push(`Ref-Tab ${refTab} ist leer`);
      const missingTags = tagWarnings(text, tabRefs);
      if (missingTags.length) refNotes.push(`${missingTags.join(", ")} gibt es in Ref-Tab ${refTab} nicht`);
    } else if (wanted !== null) {
      refNotes.push(`„Ref-Tab ${wanted}“ ignoriert – keine Ref-Tabs geladen`);
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
      });
    }
  });
  if (items.length > VIDEO_BATCH_MAX) errors.push({ block: 0, message: `Höchstens ${VIDEO_BATCH_MAX} Clips pro Batch` });
  return { items, errors, skipped };
}

/** Einstellungen für einen einzelnen Clip des Batches (so wird er auch gespeichert → „nochmal“ geht) */
export function settingsForItem(s: H3Settings, item: VideoBatchItem): H3Settings {
  const { batchText: _b, refTabs: _t, ...base } = s;
  const rest = item.refs ? { ...base, refs: item.refs, refTab: item.refTab ?? base.refTab } : base;
  return item.blocks
    ? { ...rest, promptInput: "blocks", blocks: item.blocks, fullPrompt: "", clipName: item.name }
    : { ...rest, promptInput: "full", fullPrompt: item.text, clipName: item.name };
}
