import { promises as fs } from "node:fs";
import path from "node:path";
import { REF_MAX_FILES, REF_TABS_MAX } from "../h3refs";
import type { H3Ref } from "../types";
import { config } from "./config";

// Ref-Tabs für H3: mehrere Referenz-Pakete, auf dem Server gespeichert (Handy und Laptop sehen
// dieselben Tabs, und sie überleben einen Pod-Wechsel). Einzelnutzer: letzte Änderung gewinnt.

export interface RefTabsData {
  tabs: H3Ref[][];
  /** „Tab Extra“ aus „Einstellungen übernehmen“ (null = gerade keiner) */
  extra?: H3Ref[] | null;
  updatedAt: number;
}

const file = () => config.dataPath("ref-tabs.json");

export async function getRefTabs(): Promise<RefTabsData | null> {
  try {
    return JSON.parse(await fs.readFile(file(), "utf8")) as RefTabsData;
  } catch {
    return null;
  }
}

const KINDS = new Set(["image", "audio", "video"]);
const MODES = new Set(["video", "audio", "video_audio"]);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

/** Ein Tab: nur bekannte Felder übernehmen; Unsinn → null */
export function cleanTab(tab: unknown): H3Ref[] | null {
  if (!Array.isArray(tab) || tab.length > REF_MAX_FILES + 4) return null;
  const refs: H3Ref[] = [];
  for (const r of tab as Record<string, unknown>[]) {
    if (!r || typeof r.filename !== "string" || !r.filename || r.filename.length > 300 || !KINDS.has(r.kind as string)) return null;
    const ref: H3Ref = { kind: r.kind as H3Ref["kind"], filename: r.filename };
    for (const k of ["trimStart", "trimEnd", "duration"] as const) if (num(r[k]) !== undefined) ref[k] = num(r[k]);
    if (r.kind === "video" && MODES.has(r.mediaMode as string)) ref.mediaMode = r.mediaMode as H3Ref["mediaMode"];
    refs.push(ref);
  }
  return refs;
}

/** Nur bekannte Felder übernehmen; Unsinn wird verworfen statt gespeichert */
export function cleanTabs(input: unknown): H3Ref[][] | null {
  if (!Array.isArray(input) || !input.length || input.length > REF_TABS_MAX) return null;
  const tabs: H3Ref[][] = [];
  for (const tab of input) {
    const refs = cleanTab(tab);
    if (!refs) return null;
    tabs.push(refs);
  }
  return tabs;
}

export async function saveRefTabs(tabs: H3Ref[][], extra: H3Ref[] | null = null): Promise<RefTabsData> {
  const data: RefTabsData = { tabs, extra, updatedAt: Date.now() };
  await fs.mkdir(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, file());
  return data;
}
