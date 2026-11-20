import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { comfyFetch } from "./comfy";
import { config } from "./config";
import { type HistoryEntry, getHistoryEntry, podHistory } from "./history";
import { getOnlinePods, serverMode, withPod } from "./podLink";
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
  /**
   * Name auf dem Pod, falls er hier umbenannt werden musste: Ein neuer Pod zählt wieder ab 00001
   * und erzeugt Namen, die es von einem früheren Pod schon gibt – dann bekommt die neue Datei
   * einen eindeutigen Namen, statt die alte zu überschreiben oder versteckt zu werden.
   */
  podFilename?: string;
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
  /** nach Neustart/Umstellung einmal einen größeren Teil des Verlaufs nachholen – je Pod */
  caughtUp?: Set<string>;
  catchUp?: boolean;
  /** Ab diesem Zeitpunkt wieder weit zurückschauen, weil Dateien nicht kopiert werden konnten */
  retryAt?: number;
  running: boolean;
  timer: ReturnType<typeof setInterval> | null;
  saveTimer: ReturnType<typeof setTimeout> | null;
}

const g = globalThis as unknown as { __podMirror?: State };
const st = (g.__podMirror ??= { index: null, running: false, timer: null, saveTimer: null });

const RETRY_MS = 3 * 60_000;
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

// Laufende Downloads je Zieldatei: mirrorSoon (direkt nach dem Job) und mirrorPending (alle 20 s)
// greifen oft gleichzeitig nach derselben Datei. Ohne Abgleich schrieben beide dieselbe .part-Datei,
// der zweite rename lief ins Leere (ENOENT) und der Job galt als nicht gespiegelt.
const inflight = new Map<string, Promise<void>>();

function download(f: { filename: string; subfolder: string; type: string }, dest: string): Promise<void> {
  const running = inflight.get(dest);
  if (running) return running;
  const job = (async () => {
    const qs = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type });
    const res = await comfyFetch(`/view?${qs}`, { timeoutMs: 15 * 60_000 });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const part = `${dest}.${process.pid}.${Date.now().toString(36)}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(part));
      await fs.rename(part, dest);
    } catch (err) {
      await fs.rm(part, { force: true }).catch(() => {});
      throw err;
    }
  })().finally(() => inflight.delete(dest));
  inflight.set(dest, job);
  return job;
}

/** „bild_001_00001_.png“ → „bild_001_00001__3d82a7f7.png“ (eindeutig je Job) */
export function uniqueLocalName(filename: string, promptId: string, n = 0): string {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  return `${base}__${promptId.replace(/[^\w]/g, "").slice(0, 8)}${n ? `_${n}` : ""}${ext}`;
}

/** Wo liegt (bzw. landet) diese Pod-Datei dieses Jobs auf dem Server? */
function localTarget(idx: Index, f: { subfolder: string; filename: string }, promptId: string): { filename: string; renamed: boolean } {
  // schon unter eigenem Namen gespiegelt?
  for (const m of Object.values(idx.files)) {
    if (m.promptId === promptId && m.subfolder === f.subfolder && (m.podFilename ?? m.filename) === f.filename) return { filename: m.filename, renamed: !!m.podFilename };
  }
  const cur = idx.files[key(f)];
  if (!cur || cur.promptId === promptId) return { filename: f.filename, renamed: false };
  // Name gehört einem anderen Job (früherer Pod) → eindeutigen Namen nehmen
  let n = 0;
  let name = uniqueLocalName(f.filename, promptId);
  while (idx.files[key({ subfolder: f.subfolder, filename: name })]) name = uniqueLocalName(f.filename, promptId, ++n);
  return { filename: name, renamed: true };
}

/** Kopiert alle Ausgaben eines Jobs (falls noch nicht da) und trägt sie in den Index ein. */
export async function mirrorEntry(e: HistoryEntry): Promise<boolean> {
  // im Kontext des Pods, auf dem der Job lief
  if (e.podId && serverMode()) return withPod(e.podId, () => mirrorHere(e));
  return mirrorHere(e);
}

async function mirrorHere(e: HistoryEntry): Promise<boolean> {
  const idx = await index();
  let ok = true;
  const deletedAt = idx.deletedAt ?? {};
  for (const f of e.files) {
    if (f.type !== "output" || f.kind === "audio" || isDeleted(deletedAt, f, e.timestamp)) continue;
    const target = localTarget(idx, f, e.promptId);
    const local = { subfolder: f.subfolder, filename: target.filename };
    const dest = resolveOutputFile(local.subfolder, local.filename);
    if (!dest) continue;
    try {
      const exists = await fs.stat(dest).then((s) => s.size > 0, () => false);
      if (!exists) await download(f, dest);
      idx.files[key(local)] = {
        filename: local.filename,
        subfolder: f.subfolder,
        type: "output",
        kind: f.kind,
        promptId: e.promptId,
        timestamp: e.timestamp || Date.now(),
        durationMs: e.durationMs,
        ...(target.renamed ? { podFilename: f.filename } : {}),
      };
    } catch (err) {
      ok = false;
      console.warn(`[mirror] ${f.subfolder}/${f.filename}: ${(err as Error).message}`);
    }
  }
  // Fehlgeschlagene Jobs rutschen bei großen Batches schnell aus den letzten 60 heraus – darum
  // in ein paar Minuten noch einmal den ganzen Verlauf durchgehen
  if (!ok) st.retryAt ??= Date.now() + RETRY_MS;
  if (ok && !idx.prompts.includes(e.promptId)) idx.prompts.push(e.promptId);
  saveSoon();
  return ok;
}

/** Fertige Jobs, die noch nicht gespiegelt sind, nachholen (auch Jobs aus der ComfyUI-Oberfläche) – von allen Pods. */
export async function mirrorPending() {
  if (!serverMode() || st.running) return;
  const pods = getOnlinePods();
  if (!pods.length) return;
  st.running = true;
  try {
    const idx = await index();
    const done = new Set(idx.prompts);
    const caught = (st.caughtUp ??= new Set());
    // Beim ersten Durchlauf je Pod (nach Start/Umstellung) und nach Fehlern weit zurück, sonst nur die letzten
    const retry = st.retryAt !== undefined && Date.now() >= st.retryAt;
    if (st.catchUp) caught.clear();
    st.catchUp = false;
    let allOk = true;
    for (const pod of pods) {
      try {
        const limit = caught.has(pod.id) && !retry ? 60 : 2000;
        const entries = (await withPod(pod.id, () => podHistory(limit))).filter((e) => e.status === "success" && e.files.length && !done.has(e.promptId));
        for (const e of entries) await mirrorEntry({ ...e, podId: pod.id });
        caught.add(pod.id);
      } catch {
        // dieser Pod gerade nicht erreichbar – beim nächsten Durchlauf wieder versuchen
        allOk = false;
      }
    }
    if (retry && allOk) st.retryAt = undefined;
  } finally {
    st.running = false;
  }
}

/** Direkt nach einem fertigen Job (kurz warten, bis ComfyUI den Verlauf geschrieben hat). */
export function mirrorSoon(promptId: string, podId: string | null = null) {
  if (!serverMode()) return;
  setTimeout(async () => {
    try {
      const e = podId ? await withPod(podId, () => getHistoryEntry(promptId)) : await getHistoryEntry(promptId);
      if (e && e.status === "success") await mirrorEntry({ ...e, podId: e.podId ?? podId ?? undefined });
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
    const m = idx.files[key(f)];
    delete idx.files[key(f)];
    deletedAt[key(f)] = now;
    // umbenannte Kopie: auch den Pod-Namen vermerken, sonst taucht der Live-Eintrag wieder auf
    if (m?.podFilename) deletedAt[key({ subfolder: m.subfolder, filename: m.podFilename })] = now;
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

/** Job, dem die gespiegelte Datei unter diesem Namen gehört (null = keine Kopie) */
export async function mirroredOwner(f: { subfolder: string; filename: string }): Promise<string | null> {
  return (await index()).files[key(f)]?.promptId ?? null;
}
