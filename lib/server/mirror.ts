import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { comfyFetch } from "./comfy";
import { config } from "./config";
import { type HistoryEntry, getHistory, getHistoryEntry } from "./history";
import { getPodLink, serverMode } from "./podLink";
import { resolveOutputFile } from "./zip";

// Server-Modus: Jedes fertige Bild/Video wird vom Pod auf den Server kopiert und in einem Index
// vermerkt. So bleiben Galerie, Favoriten, ZIP und Löschen auch ohne laufenden Pod nutzbar.

export interface MirroredFile {
  filename: string;
  subfolder: string;
  type: "output";
  kind: "image" | "video";
  promptId: string;
  timestamp: number;
  durationMs: number | null;
}

interface Index {
  files: Record<string, MirroredFile>;
  /** komplett gespiegelte prompt_ids */
  prompts: string[];
  /** alt (nur Dateiname) – wird beim Laden verworfen, siehe deletedAt */
  deleted?: string[];
  /**
   * Auf dem Server gelöscht: Schlüssel → Zeitpunkt des Löschens (ms). Nicht erneut vom Pod holen
   * und nicht anzeigen – aber nur, was VOR dem Löschen entstanden ist. Ein neuer Pod zählt wieder
   * ab 00001 und erzeugt dieselben Dateinamen; die müssen sichtbar bleiben.
   */
  deletedAt?: Record<string, number>;
}

interface State {
  index: Index | null;
  /** nach Neustart/Umstellung einmal einen größeren Teil des Verlaufs nachholen */
  catchUp?: boolean;
  running: boolean;
  timer: ReturnType<typeof setInterval> | null;
  saveTimer: ReturnType<typeof setTimeout> | null;
}

const g = globalThis as unknown as { __podMirror?: State };
const st = (g.__podMirror ??= { index: null, running: false, timer: null, saveTimer: null });

const key = (f: { subfolder: string; filename: string }) => `${f.subfolder}/${f.filename}`;
const indexFile = () => config.dataPath("outputs-index.json");

async function index(): Promise<Index> {
  if (!st.index) {
    try {
      st.index = JSON.parse(await fs.readFile(indexFile(), "utf8"));
    } catch {
      st.index = { files: {}, prompts: [] };
    }
    const idx = st.index!;
    if (idx.deleted) {
      // Alte Vermerke ohne Zeit haben neue Bilder mit gleichem Namen versteckt → verwerfen und
      // die letzten Jobs noch einmal prüfen, damit versteckte Bilder nachgeholt werden
      delete idx.deleted;
      idx.prompts = [];
      st.catchUp = true;
      saveSoon();
    }
  }
  return st.index!;
}

/** Datei gilt als gelöscht, wenn sie nicht nach dem Löschen neu entstanden ist */
export function isDeleted(deletedAt: Record<string, number>, f: { subfolder: string; filename: string }, timestamp: number | null | undefined) {
  const at = deletedAt[key(f)];
  return at !== undefined && (timestamp ?? 0) <= at;
}

function saveSoon() {
  if (st.saveTimer) return;
  st.saveTimer = setTimeout(async () => {
    st.saveTimer = null;
    const idx = await index();
    idx.prompts = idx.prompts.slice(-5000);
    await fs.mkdir(path.dirname(indexFile()), { recursive: true });
    const tmp = `${indexFile()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(idx));
    await fs.rename(tmp, indexFile());
  }, 500);
}

async function download(f: { filename: string; subfolder: string; type: string }, dest: string) {
  const qs = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type });
  const res = await comfyFetch(`/view?${qs}`, { timeoutMs: 15 * 60_000 });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(part));
  await fs.rename(part, dest);
}

/** Kopiert alle Ausgaben eines Jobs (falls noch nicht da) und trägt sie in den Index ein. */
export async function mirrorEntry(e: HistoryEntry): Promise<boolean> {
  const idx = await index();
  let ok = true;
  const deletedAt = idx.deletedAt ?? {};
  for (const f of e.files) {
    if (f.type !== "output" || f.kind === "audio" || isDeleted(deletedAt, f, e.timestamp)) continue;
    const dest = resolveOutputFile(f.subfolder, f.filename);
    if (!dest) continue;
    try {
      const exists = await fs.stat(dest).then((s) => s.size > 0, () => false);
      if (!exists) await download(f, dest);
      idx.files[key(f)] = {
        filename: f.filename,
        subfolder: f.subfolder,
        type: "output",
        kind: f.kind,
        promptId: e.promptId,
        timestamp: e.timestamp || Date.now(),
        durationMs: e.durationMs,
      };
    } catch (err) {
      ok = false;
      console.warn(`[mirror] ${f.subfolder}/${f.filename}: ${(err as Error).message}`);
    }
  }
  if (ok && !idx.prompts.includes(e.promptId)) idx.prompts.push(e.promptId);
  saveSoon();
  return ok;
}

/** Fertige Jobs, die noch nicht gespiegelt sind, nachholen (auch Jobs aus der ComfyUI-Oberfläche). */
export async function mirrorPending() {
  if (!serverMode() || !getPodLink() || st.running) return;
  st.running = true;
  try {
    const idx = await index();
    const done = new Set(idx.prompts);
    // Beim ersten Durchlauf nach dem Start (oder nach der Umstellung) weit zurück, danach nur die letzten
    const limit = st.catchUp === false ? 60 : 2000;
    const entries = (await getHistory(limit)).filter((e) => e.status === "success" && e.files.length && !done.has(e.promptId));
    for (const e of entries) await mirrorEntry(e);
    st.catchUp = false;
  } catch {
    // Pod gerade nicht erreichbar – beim nächsten Durchlauf wieder versuchen
  } finally {
    st.running = false;
  }
}

/** Direkt nach einem fertigen Job (kurz warten, bis ComfyUI den Verlauf geschrieben hat). */
export function mirrorSoon(promptId: string) {
  if (!serverMode()) return;
  setTimeout(async () => {
    try {
      const e = await getHistoryEntry(promptId);
      if (e && e.status === "success") await mirrorEntry(e);
    } catch {}
  }, 1500);
}

export function startMirrorLoop() {
  if (!serverMode() || st.timer) return;
  st.timer = setInterval(mirrorPending, 20_000);
  mirrorPending();
}

/** Gespiegelte Dateien, die noch auf der Platte liegen – neueste zuerst. */
export async function listMirrored(): Promise<MirroredFile[]> {
  const idx = await index();
  const list = Object.values(idx.files);
  const keep = await Promise.all(
    list.map((f) => {
      const abs = resolveOutputFile(f.subfolder, f.filename);
      return abs ? fs.access(abs).then(() => true, () => false) : false;
    }),
  );
  return list.filter((_, i) => keep[i]).sort((a, b) => b.timestamp - a.timestamp);
}

export async function forgetMirrored(f: { subfolder: string; filename: string }) {
  await forgetMirroredMany([f]);
}

/** Aus dem Index nehmen und merken, damit der Spiegel sie nicht erneut vom Pod holt. */
export async function forgetMirroredMany(list: { subfolder: string; filename: string }[]) {
  if (!list.length) return;
  const idx = await index();
  const now = Date.now();
  const deletedAt = (idx.deletedAt ??= {});
  for (const f of list) {
    delete idx.files[key(f)];
    deletedAt[key(f)] = now;
  }
  // nicht endlos wachsen lassen: nur die jüngsten 50 000 Vermerke behalten
  const keys = Object.keys(deletedAt);
  if (keys.length > 50_000) for (const k of keys.sort((a, b) => deletedAt[a] - deletedAt[b]).slice(0, keys.length - 50_000)) delete deletedAt[k];
  saveSoon();
}

/** Vermerke „gelöscht“ (Schlüssel → Zeitpunkt) für die Galerie */
export async function deletedMap(): Promise<Record<string, number>> {
  return (await index()).deletedAt ?? {};
}
