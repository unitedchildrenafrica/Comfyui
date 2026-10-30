import { H3_BLOCK_KEYS, type H3BlockKey, type H3Blocks } from "./types";

export const H3_BLOCK_LABELS: Record<H3BlockKey, string> = {
  subject_definitions: "Subject Definitions",
  summary: "Summary",
  retention_analysis: "Retention Analysis",
  detailed_description: "Detailed Description",
  overall_soundscape: "Overall Soundscape",
  non_diegetic_music: "Non-diegetic Music",
};

export function emptyBlocks(): H3Blocks {
  return {
    subject_definitions: "",
    summary: "",
    retention_analysis: "",
    detailed_description: "",
    overall_soundscape: "",
    non_diegetic_music: "N/A",
  };
}

/** Gleiche Form wie build_ref_prompt() in ComfyUI-DaSiWa-Nodes. */
export function buildH3Prompt(blocks: H3Blocks): string {
  return H3_BLOCK_KEYS.map((key) => {
    let value = (blocks[key] ?? "").trim();
    if (key === "non_diegetic_music" && !value) value = "N/A";
    return `${key}:\n${value}`;
  }).join("\n\n");
}

// Aliase wie in DaSiWa (_REF_HEADINGS)
const HEADINGS: Record<string, H3BlockKey> = {
  subject_definitions: "subject_definitions",
  summary: "summary",
  retention_analysis: "retention_analysis",
  detailed_description: "detailed_description",
  overall_soundscape: "overall_soundscape",
  soundscape: "overall_soundscape",
  non_diegetic_music: "non_diegetic_music",
  music: "non_diegetic_music",
};

const HEADING_RE = new RegExp(`^[ \\t]*(${Object.keys(HEADINGS).join("|")})[ \\t]*:[ \\t]*`, "gim");

/**
 * Erkennt die sechs Blöcke in einem eingefügten Prompt. Unbekannter Text vor dem
 * ersten Block oder fehlende/doppelte Blöcke → null (dann bleibt es Freitext).
 */
export function parseH3Prompt(text: string): H3Blocks | null {
  const matches = [...text.matchAll(HEADING_RE)];
  if (!matches.length) return null;
  const keys = matches.map((m) => HEADINGS[m[1].toLowerCase()]);
  if (new Set(keys).size !== keys.length) return null;
  if (text.slice(0, matches[0].index).trim()) return null;
  const blocks = emptyBlocks();
  blocks.non_diegetic_music = "";
  matches.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    blocks[keys[i]] = text.slice(start, end).trim();
  });
  if (keys.length < 6 && !keys.includes("non_diegetic_music")) blocks.non_diegetic_music = "N/A";
  return blocks;
}

// --- Clip-Name aus der ersten Zeile ---------------------------------------------------

/** „Clip 35“, „Clip #44“, „Szene 3b“, „Shot_12“ … */
const CLIP_LINE = /^(clip|szene|scene|shot|teil|part)\s*[#_\-.:]?\s*\d+[\w\- ]{0,40}$/i;
/** „Name: …“, „Titel: …“, „Clip: …“ */
const NAMED_LINE = /^(name|titel|title|clip|dateiname|filename)\s*:\s*(.{1,80})$/i;

/** Markdown-Reste entfernen, die Claude gern um eine Zeile setzt (# **Clip 35** `…`) */
const plainLine = (line: string) => line.trim().replace(/^#+\s*/, "").replace(/^[*_`]+|[*_`]+$/g, "").trim();

/**
 * Erste Zeile als Clip-Name abtrennen. Erkannt wird sie, wenn sie wie „Clip 35“ oder
 * „Name: …“ aussieht – oder (nur wenn danach die Blöcke kommen) jede kurze erste Zeile.
 * Code-Zäune (```) um den ganzen Text werden dabei mit entfernt.
 */
export function splitClipName(raw: string): { name: string; text: string } {
  let text = raw.replace(/\r\n/g, "\n");
  const fenced = text.trim().match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (fenced) text = fenced[1];
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.trim());
  if (first < 0) return { name: "", text };
  const line = plainLine(lines[first]);
  const rest = lines.slice(first + 1).join("\n");
  if (CLIP_LINE.test(line)) return { name: line.replace(/^(\w+)\s*[:#]\s*/, "$1 "), text: rest.trim() };
  const named = line.match(NAMED_LINE);
  if (named) return { name: plainLine(named[2]), text: rest.trim() };
  // Beliebige kurze Zeile vor den Blöcken (aber selbst keine Block-Überschrift)
  const isHeading = new RegExp(HEADING_RE.source, "im").test(lines[first]);
  if (!isHeading && line.length <= 60 && !line.includes(":") && parseH3Prompt(rest)) return { name: line, text: rest.trim() };
  return { name: "", text: raw };
}

/** Dateisicherer Name: „Clip 35 – Pool“ → „Clip_35_-_Pool“ */
export function safeClipName(name: string): string {
  return name
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f%]+/g, " ")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/^[._]+|_+$/g, "")
    .slice(0, 80);
}

/** Zahl am Ende hochzählen: „Clip 35“ → „Clip 36“, „Clip_09“ → „Clip_10“ */
export function nextClipName(name: string): string | null {
  const m = name.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return null;
  const n = String(Number(m[2]) + 1).padStart(m[2].length, "0");
  return `${m[1]}${n}${m[3]}`;
}

const DIALOGUE_TAG = /<d>|<\/d>|\(S\d+\)/i;
const NO_DIALOGUE_PHRASE = /no dialogue,\s*no speech,\s*no voices/i;
const DIALOGUE_LINE = /\(S\d+\)\s*<d>\[[A-Za-z]+\][^<]*<\/d>/;

/** Nur Warnungen, blockiert nie. */
export function checkH3Prompt(text: string, soundscape: string, noDialogue: boolean): string[] {
  const warnings: string[] = [];
  if (noDialogue) {
    if (DIALOGUE_TAG.test(text)) warnings.push("„Kein Dialog“ ist aktiv, aber der Text enthält <d>-Tags oder (S1)-Sprecher.");
    if (!NO_DIALOGUE_PHRASE.test(soundscape || text))
      warnings.push("Im Soundscape fehlt „no dialogue, no speech, no voices“.");
  } else {
    const speakerMentions = text.match(/\(S\d+\)|<d>/gi) ?? [];
    if (speakerMentions.length && !DIALOGUE_LINE.test(text))
      warnings.push("Dialog sollte im Format (S1) <d>[English] …</d> stehen.");
    if (/<d>/i.test(text)) {
      const open = (text.match(/<d>/gi) ?? []).length;
      const close = (text.match(/<\/d>/gi) ?? []).length;
      if (open !== close) warnings.push(`Ungleich viele <d> (${open}) und </d> (${close}).`);
    }
    if (/<d>(?!\[)/i.test(text)) warnings.push("Nach <d> fehlt die Sprachangabe, z. B. <d>[English].");
  }
  return warnings;
}
