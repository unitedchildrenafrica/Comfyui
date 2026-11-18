import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { config } from "./config";
import {
  type KneteItem,
  type KneteJob,
  type KneteSettings,
  KNETE_MAX_REFS,
  costFromUsage,
  describeOpenAIError,
  isFatalOpenAIError,
  isRetryableStatus,
  normalizeKneteSettings,
  outputSize,
  safeBase,
  safeFolder,
  type OpenAIImageUsage,
} from "../knete";

// Ablage:
//   DATA_DIR/knete/settings.json         Einstellungen (Modell, Prompt …)
//   DATA_DIR/knete/refs/                 aktuelle Stil-Referenzen
//   DATA_DIR/knete/jobs/<id>/job.json    Auftrag mit Status pro Foto
//   DATA_DIR/knete/jobs/<id>/in/         hochgeladene Fotos (normalisiert)
//   DATA_DIR/knete/jobs/<id>/refs/       Kopie der Referenzen beim Anlegen des Auftrags
//   OUTPUT_DIR/knete/<folder>/           fertige Bilder (→ Galerie-Ordner und ZIP)

const FILE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,120}$/;
const ID = /^[a-z0-9]{6,32}$/;

export const openaiKey = () => process.env.OPENAI_API_KEY || "";
const openaiBase = () => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

const root = (...p: string[]) => config.dataPath("knete", ...p);
const jobDir = (id: string, ...p: string[]) => root("jobs", id, ...p);
export const outputFolder = (folder: string) => path.join(config.outputDir, "knete", folder);

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${randomBytes(3).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 1));
  await fs.rename(tmp, file);
}

// --- Einstellungen ---------------------------------------------------------------------

export async function getKneteSettings(): Promise<KneteSettings> {
  return normalizeKneteSettings(await readJson<Partial<KneteSettings>>(root("settings.json"), {}));
}

export async function saveKneteSettings(raw: Partial<KneteSettings>) {
  const s = normalizeKneteSettings(raw);
  await writeJson(root("settings.json"), s);
  state().concurrency = s.concurrency;
  pump();
  return s;
}

// --- Bilder normalisieren ----------------------------------------------------------------

/** Dreht nach EXIF, verkleinert auf maxSide und speichert als JPEG. Gibt die Größe zurück. */
async function normalizeImage(data: Buffer, file: string, maxSide: number) {
  const sharp = (await import("sharp")).default;
  let out: { data: Buffer; info: { width: number; height: number } };
  try {
    out = await sharp(data, { failOn: "none" })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new Error("Bildformat wird nicht unterstützt (bitte JPEG/PNG/WebP)");
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, out.data);
  return { width: out.info.width, height: out.info.height };
}

// --- Referenzen --------------------------------------------------------------------------

export async function listRefs(): Promise<string[]> {
  const names = await fs.readdir(root("refs")).catch(() => [] as string[]);
  return names.filter((n) => FILE.test(n) && n.endsWith(".jpg")).sort();
}

export async function addRef(data: Buffer) {
  const refs = await listRefs();
  if (refs.length >= KNETE_MAX_REFS) throw new Error(`Höchstens ${KNETE_MAX_REFS} Referenzbilder`);
  const name = `${Date.now()}_${randomBytes(3).toString("hex")}.jpg`;
  await normalizeImage(data, root("refs", name), 1536);
  return name;
}

export async function deleteRef(name: string) {
  if (!FILE.test(name)) return;
  await fs.rm(root("refs", name), { force: true });
}

// --- Dateien für die Anzeige -------------------------------------------------------------

/** Absoluter Pfad einer Datei für /api/knete/file, abgesichert gegen Pfad-Tricks. */
export async function resolveKneteFile(kind: string, jobId: string, name: string): Promise<string | null> {
  if (!FILE.test(name)) return null;
  if (kind === "ref") return root("refs", name);
  if (!ID.test(jobId)) return null;
  if (kind === "in") return jobDir(jobId, "in", name);
  if (kind === "jobref") return jobDir(jobId, "refs", name);
  if (kind === "out") {
    const job = await getJob(jobId);
    return job ? path.join(outputFolder(job.folder), name) : null;
  }
  return null;
}

// --- Aufträge ----------------------------------------------------------------------------

interface State {
  loaded: Promise<void> | null;
  jobs: Map<string, KneteJob>;
  running: number;
  concurrency: number;
  aborts: Map<string, AbortController>;
  saving: Map<string, Promise<void>>;
}

const g = globalThis as unknown as { __knete?: State };
function state(): State {
  g.__knete ??= { loaded: null, jobs: new Map(), running: 0, concurrency: 3, aborts: new Map(), saving: new Map() };
  return g.__knete;
}

/** Lädt beim ersten Aufruf alle Aufträge und setzt unterbrochene fort (z. B. nach Neustart der App). */
export function ensureLoaded(): Promise<void> {
  const st = state();
  st.loaded ??= (async () => {
    st.concurrency = (await getKneteSettings()).concurrency;
    const ids = await fs.readdir(root("jobs")).catch(() => [] as string[]);
    for (const id of ids) {
      if (!ID.test(id)) continue;
      const job = await readJson<KneteJob | null>(jobDir(id, "job.json"), null);
      if (!job) continue;
      for (const it of job.items) if (it.status === "running") it.status = "pending";
      st.jobs.set(id, job);
    }
    pump();
  })();
  return st.loaded;
}

function persist(job: KneteJob): Promise<void> {
  // Schreibvorgänge pro Auftrag nacheinander, damit kein älterer Stand einen neueren überschreibt
  const st = state();
  const prev = st.saving.get(job.id) ?? Promise.resolve();
  const next = prev.then(() => writeJson(jobDir(job.id, "job.json"), job)).catch((err) => console.error("[knete] speichern", err));
  st.saving.set(job.id, next);
  return next;
}

export async function getJob(id: string): Promise<KneteJob | null> {
  await ensureLoaded();
  return state().jobs.get(id) ?? null;
}

export async function listJobs(): Promise<KneteJob[]> {
  await ensureLoaded();
  return [...state().jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export async function createJob(folderName?: string): Promise<KneteJob> {
  await ensureLoaded();
  const refs = await listRefs();
  if (!refs.length) throw new Error("Erst Stil-Referenzen hochladen");
  const id = `${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
  let folder = safeFolder(folderName);
  // Ordner nicht mit einem anderen Auftrag teilen (sonst überschreiben sich 001_bild.png & Co.)
  const used = new Set([...state().jobs.values()].map((j) => j.folder));
  for (let n = 2; used.has(folder); n++) folder = `${safeFolder(folderName)}_${n}`;
  await fs.mkdir(jobDir(id, "refs"), { recursive: true });
  for (const r of refs) await fs.copyFile(root("refs", r), jobDir(id, "refs", r));
  const job: KneteJob = { id, folder, createdAt: Date.now(), settings: await getKneteSettings(), refs, items: [] };
  state().jobs.set(id, job);
  await persist(job);
  return job;
}

export async function addPhoto(jobId: string, data: Buffer, originalName: string): Promise<KneteItem> {
  const job = await getJob(jobId);
  if (!job) throw new Error("Auftrag nicht gefunden");
  const i = job.items.reduce((m, x) => Math.max(m, x.i), 0) + 1;
  const input = `${String(i).padStart(3, "0")}_${safeBase(originalName)}.jpg`;
  const { width, height } = await normalizeImage(data, jobDir(jobId, "in", input), 2048);
  const item: KneteItem = { i, name: originalName.slice(0, 200), input, width, height, status: "pending", updatedAt: Date.now() };
  job.items.push(item);
  await persist(job);
  pump();
  return item;
}

export async function jobAction(jobId: string, action: string, index?: number): Promise<KneteJob> {
  const job = await getJob(jobId);
  if (!job) throw new Error("Auftrag nicht gefunden");
  const now = Date.now();
  if (action === "cancel") {
    for (const it of job.items) {
      if (it.status === "pending") Object.assign(it, { status: "cancelled", updatedAt: now });
      if (it.status === "running") state().aborts.get(`${job.id}:${it.i}`)?.abort();
    }
  } else if (action === "retry-failed") {
    for (const it of job.items) if (it.status === "error" || it.status === "cancelled") Object.assign(it, { status: "pending", error: undefined, updatedAt: now });
    job.paused = undefined;
  } else if (action === "retry") {
    const it = job.items.find((x) => x.i === index);
    if (!it) throw new Error("Bild nicht gefunden");
    if (it.status !== "running") Object.assign(it, { status: "pending", error: undefined, updatedAt: now });
    job.paused = undefined;
  } else if (action === "resume") {
    job.paused = undefined;
  } else {
    throw new Error(`Unbekannte Aktion: ${action}`);
  }
  await persist(job);
  pump();
  return job;
}

/** Auftrag löschen: hochgeladene Fotos weg, fertige Bilder bleiben im Ordner knete/<folder>. */
export async function deleteJob(jobId: string) {
  const job = await getJob(jobId);
  if (!job) return;
  for (const it of job.items) if (it.status === "running") state().aborts.get(`${job.id}:${it.i}`)?.abort();
  state().jobs.delete(jobId);
  await (state().saving.get(jobId) ?? Promise.resolve());
  await fs.rm(jobDir(jobId), { recursive: true, force: true });
}

// --- Abarbeiten --------------------------------------------------------------------------

function nextPending(): { job: KneteJob; item: KneteItem } | null {
  const jobs = [...state().jobs.values()].filter((j) => !j.paused).sort((a, b) => a.createdAt - b.createdAt);
  for (const job of jobs) {
    const item = job.items.find((x) => x.status === "pending");
    if (item) return { job, item };
  }
  return null;
}

function pump() {
  const st = state();
  if (!openaiKey()) return;
  while (st.running < st.concurrency) {
    const next = nextPending();
    if (!next) return;
    const { job, item } = next;
    item.status = "running";
    item.error = undefined;
    item.updatedAt = Date.now();
    st.running++;
    void persist(job);
    processItem(job, item)
      .catch((err) => console.error("[knete]", err))
      .finally(() => {
        st.running--;
        pump();
      });
  }
}

class OpenAIError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: { error?: { message?: string; code?: string | null } } | null,
  ) {
    super(message);
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new Error("abgebrochen"))), { once: true });
  });

async function processItem(job: KneteJob, item: KneteItem) {
  const key = `${job.id}:${item.i}`;
  const ctrl = new AbortController();
  state().aborts.set(key, ctrl);
  const started = Date.now();
  try {
    const photo = await fs.readFile(jobDir(job.id, "in", item.input));
    const refs = await Promise.all(job.refs.map((r) => fs.readFile(jobDir(job.id, "refs", r))));
    const size = outputSize(item.width, item.height, job.settings.size);

    let result: { image: Buffer; usage?: OpenAIImageUsage } | null = null;
    for (let attempt = 1; ; attempt++) {
      try {
        result = await callOpenAI({ ...job.settings, size }, photo, refs, ctrl.signal);
        break;
      } catch (err) {
        if (ctrl.signal.aborted) throw err;
        const retryable = err instanceof OpenAIError ? isRetryableStatus(err.status, err.body) : true; // Netzwerkfehler
        if (!retryable || attempt >= 4) throw err;
        await sleep([0, 15_000, 45_000, 90_000][attempt], ctrl.signal);
      }
    }

    const dir = outputFolder(job.folder);
    await fs.mkdir(dir, { recursive: true });
    const output = item.input.replace(/\.jpg$/, ".png");
    await fs.writeFile(path.join(dir, output), result.image);
    Object.assign(item, { status: "done", output, error: undefined, costUsd: costFromUsage(result.usage), ms: Date.now() - started, updatedAt: Date.now() });
  } catch (err) {
    if (ctrl.signal.aborted) {
      Object.assign(item, { status: "cancelled", error: undefined, updatedAt: Date.now() });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      Object.assign(item, { status: "error", error: message, ms: Date.now() - started, updatedAt: Date.now() });
      // Schlüssel ungültig / Guthaben leer: Auftrag anhalten statt alle weiteren Fotos scheitern zu lassen
      if (err instanceof OpenAIError && isFatalOpenAIError(err.status, err.body)) job.paused = message;
    }
  } finally {
    state().aborts.delete(key);
    if (state().jobs.has(job.id)) await persist(job);
  }
}

async function callOpenAI(s: Omit<KneteSettings, "size"> & { size: string }, photo: Buffer, refs: Buffer[], signal: AbortSignal) {
  const form = new FormData();
  form.append("model", s.model);
  form.append("prompt", s.prompt);
  // Bild 1 = das Foto, danach die Stil-Referenzen (so steht es auch im Prompt)
  form.append("image[]", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "photo.jpg");
  refs.forEach((r, n) => form.append("image[]", new Blob([new Uint8Array(r)], { type: "image/jpeg" }), `style_ref_${n + 1}.jpg`));
  form.append("size", s.size);
  form.append("quality", s.quality);
  form.append("output_format", "png");
  // Echte Fotos von Personen: weniger strenger Filter, damit harmlose Bilder nicht abgelehnt werden
  form.append("moderation", "low");
  form.append("n", "1");

  const timeout = AbortSignal.timeout(10 * 60_000);
  const res = await fetch(`${openaiBase()}/images/edits`, {
    method: "POST",
    headers: { authorization: `Bearer ${openaiKey()}` },
    body: form,
    signal: AbortSignal.any([signal, timeout]),
  });
  const text = await res.text();
  let body: { data?: { b64_json?: string }[]; usage?: OpenAIImageUsage; error?: { message?: string; code?: string | null } } | null = null;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new OpenAIError(describeOpenAIError(res.status, body), res.status, body);
  const b64 = body?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI hat kein Bild zurückgegeben");
  return { image: Buffer.from(b64, "base64"), usage: body?.usage };
}

// --- Galerie -----------------------------------------------------------------------------

export interface KneteGalleryRow {
  file: { filename: string; subfolder: string; type: string; kind: "image" };
  promptId: string;
  timestamp: number;
  durationMs: number | null;
  label: string;
}

/** Fertige Knete-Bilder für die Galerie (laufen nicht über ComfyUI, stehen also nicht in /history). */
export async function kneteGalleryRows(): Promise<KneteGalleryRow[]> {
  const rows: KneteGalleryRow[] = [];
  for (const job of await listJobs()) {
    for (const it of job.items) {
      if (it.status !== "done" || !it.output) continue;
      // In der Galerie gelöschte Dateien nicht wieder anzeigen
      const exists = await fs.access(path.join(outputFolder(job.folder), it.output)).then(() => true, () => false);
      if (!exists) continue;
      rows.push({
        file: { filename: it.output, subfolder: `knete/${job.folder}`, type: "output", kind: "image" },
        promptId: `knete_${job.id}_${it.i}`,
        timestamp: it.updatedAt,
        durationMs: it.ms ?? null,
        label: `Knete: ${it.name}`,
      });
    }
  }
  return rows;
}
