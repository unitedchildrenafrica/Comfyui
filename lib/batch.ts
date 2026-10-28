import { isSafeName } from "./builders/common";
import type { PromptItem } from "./types";

export interface BatchError {
  block: number;
  message: string;
}

const KEY_RE = /^\s*(positive|negative|name)\s*:\s?(.*)$/i;

/**
 * Format:
 *   positive: …
 *   negative: …   (optional → globales Standard-Negativ)
 *   name: …       (optional → bild_###)
 *   ---
 * Folgezeilen ohne Schlüssel gehören zum vorherigen Feld.
 */
export function parseBatch(text: string, defaultNegative: string): { items: PromptItem[]; errors: BatchError[] } {
  const items: PromptItem[] = [];
  const errors: BatchError[] = [];
  const blocks = text.replace(/\r\n/g, "\n").split(/^\s*---\s*$/m);
  const seen = new Set<string>();
  let block = 0;

  blocks.forEach((raw) => {
    if (!raw.trim()) return;
    block++;
    const fields: Record<string, string[]> = {};
    let current: string | null = null;
    let bad = false;
    for (const line of raw.split("\n")) {
      const m = line.match(KEY_RE);
      if (m) {
        current = m[1].toLowerCase();
        if (fields[current]) {
          errors.push({ block, message: `„${current}:“ kommt doppelt vor` });
          bad = true;
        }
        fields[current] = [m[2]];
      } else if (line.trim()) {
        if (!current) {
          errors.push({ block, message: `Zeile ohne Schlüssel: „${line.trim().slice(0, 40)}“` });
          bad = true;
        } else fields[current].push(line);
      }
    }
    const get = (k: string) => (fields[k] ?? []).join("\n").trim();
    const positive = get("positive");
    if (!positive) {
      errors.push({ block, message: "„positive:“ fehlt oder ist leer" });
      bad = true;
    }
    const name = get("name") || `bild_${String(block).padStart(3, "0")}`;
    if (!isSafeName(name)) {
      errors.push({ block, message: `Ungültiger Name „${name}“ (erlaubt: Buchstaben, Ziffern, _ - .)` });
      bad = true;
    } else if (seen.has(name)) {
      errors.push({ block, message: `Name „${name}“ ist doppelt` });
      bad = true;
    }
    if (bad) return;
    seen.add(name);
    items.push({ positive, negative: get("negative") || defaultNegative, name });
  });
  return { items, errors };
}
