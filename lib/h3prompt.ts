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
