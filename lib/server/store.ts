import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config";
import { builtinPresets, DEFAULT_NEGATIVE } from "../defaults";
import type { BatchRecord, ImageSettings, JobRecord } from "../types";

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 1));
  await fs.rename(tmp, file);
}

const safeId = (id: string) => /^[A-Za-z0-9_-]+$/.test(id);

// --- Jobs ---------------------------------------------------------------------------

export async function saveJob(job: JobRecord) {
  await writeJson(config.dataPath("jobs", `${job.promptId}.json`), job);
}

export async function getJob(promptId: string): Promise<JobRecord | null> {
  if (!safeId(promptId)) return null;
  return readJson<JobRecord | null>(config.dataPath("jobs", `${promptId}.json`), null);
}

export async function getJobs(ids: string[]): Promise<Record<string, JobRecord>> {
  const out: Record<string, JobRecord> = {};
  await Promise.all(
    ids.map(async (id) => {
      const job = await getJob(id);
      if (job) out[id] = job;
    }),
  );
  return out;
}

// --- Batches ------------------------------------------------------------------------

export async function saveBatch(batch: BatchRecord) {
  await writeJson(config.dataPath("batches", `${batch.id}.json`), batch);
}

export async function getBatch(id: string): Promise<BatchRecord | null> {
  if (!safeId(id)) return null;
  return readJson<BatchRecord | null>(config.dataPath("batches", `${id}.json`), null);
}

// --- Presets ------------------------------------------------------------------------

type Presets = Record<string, ImageSettings>;

export async function getPresets(): Promise<Presets> {
  const file = config.dataPath("presets.json");
  const existing = await readJson<Presets | null>(file, null);
  if (existing) return existing;
  const initial = builtinPresets();
  await writeJson(file, initial).catch(() => {});
  return initial;
}

export async function savePreset(name: string, settings: ImageSettings) {
  const presets = await getPresets();
  presets[name] = settings;
  await writeJson(config.dataPath("presets.json"), presets);
}

export async function deletePreset(name: string) {
  const presets = await getPresets();
  delete presets[name];
  await writeJson(config.dataPath("presets.json"), presets);
}

// --- App-Einstellungen --------------------------------------------------------------

export interface AppSettings {
  folders: { wai: string; pony: string; anima: string };
  defaultNegative: string;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  folders: { wai: "wai", pony: "pony", anima: "anima" },
  defaultNegative: DEFAULT_NEGATIVE,
};

export async function getAppSettings(): Promise<AppSettings> {
  const s = await readJson<Partial<AppSettings>>(config.dataPath("settings.json"), {});
  return { ...DEFAULT_APP_SETTINGS, ...s, folders: { ...DEFAULT_APP_SETTINGS.folders, ...s.folders } };
}

export async function saveAppSettings(s: AppSettings) {
  await writeJson(config.dataPath("settings.json"), s);
}

// --- Favoriten (geordnete Liste, Reihenfolge änderbar) ---------------------------------

export interface FavoriteItem {
  filename: string;
  subfolder: string;
  type: string;
  kind: "image" | "video";
  promptId: string;
  label: string;
  timestamp: number;
  [key: string]: unknown;
}

export const favKey = (f: { filename: string; subfolder: string }) => `${f.subfolder}/${f.filename}`;

export async function getFavorites(): Promise<FavoriteItem[]> {
  const list = await readJson<FavoriteItem[]>(config.dataPath("favorites.json"), []);
  return Array.isArray(list) ? list : [];
}

export async function saveFavorites(list: FavoriteItem[]) {
  // doppelte Einträge entfernen, Reihenfolge beibehalten
  const seen = new Set<string>();
  const clean = list.filter((f) => f?.filename && !seen.has(favKey(f)) && seen.add(favKey(f)));
  await writeJson(config.dataPath("favorites.json"), clean);
  return clean;
}

export async function removeFavorite(f: { filename: string; subfolder: string }) {
  const list = await getFavorites();
  const next = list.filter((x) => favKey(x) !== favKey(f));
  if (next.length !== list.length) await saveFavorites(next);
}
