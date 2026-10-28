import { randomUUID } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  MODEL_TYPES,
  type ModelType,
  civitaiType,
  guessTypeFromPath,
  parseModelLink,
  sanitizeModelFilename,
} from "../modelLinks";
import { clearNodeInfoCache } from "./comfy";
import { config } from "./config";

// --- Link auflösen -------------------------------------------------------------------

export interface ResolvedFile {
  url: string;
  filename: string;
  sizeBytes: number | null;
  type: ModelType | null;
  label: string;
  primary: boolean;
}

export interface Resolved {
  source: "civitai" | "huggingface" | "direct";
  title: string;
  baseModel?: string;
  versions?: { id: number; name: string }[];
  versionId?: number;
  files: ResolvedFile[];
  tokenMissing?: boolean;
  /** Hinweis für die UI, z. B. wenn die Civitai-Infos gesperrt waren */
  notice?: string;
}

interface CivitaiVersion {
  id: number;
  modelId: number;
  name: string;
  baseModel: string;
  model?: { name: string; type: string };
  files: { id: number; name: string; type: string; sizeKB: number; primary?: boolean; downloadUrl: string }[];
}

class CivitaiApiError extends Error {
  constructor(public status: number) {
    super(
      status === 451
        ? "Civitai sperrt die Modell-Infos für den Standort des Pods (HTTP 451)."
        : status === 404
          ? "Civitai: Modell/Version nicht gefunden (404)."
          : `Civitai antwortet mit HTTP ${status}.`,
    );
  }
}

/**
 * Ohne Civitai-API (z. B. Region gesperrt, 451): Dateiname und Größe direkt über den
 * Download-Link ermitteln. Civitai leitet auf den Speicher um; der Dateiname steht im
 * Parameter b2ContentDisposition bzw. im Content-Disposition-Header.
 */
export async function probeDownload(rawUrl: string): Promise<{ filename: string | null; sizeBytes: number | null }> {
  const { url, headers } = authedUrl(rawUrl);
  const res = await fetch(url, { headers: { ...headers, range: "bytes=0-0" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  await res.body?.cancel().catch(() => {});
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? `Download verweigert (HTTP ${res.status}) – CIVITAI_TOKEN fehlt oder Modell braucht Login`
        : `Download-Link antwortet mit HTTP ${res.status}`,
    );
  }
  const fromHeader = (v: string | null) => {
    if (!v) return null;
    const star = v.match(/filename\*=UTF-8''([^;]+)/i);
    if (star) return decodeURIComponent(star[1]);
    return v.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
  };
  let filename = fromHeader(res.headers.get("content-disposition"));
  if (!filename) {
    try {
      filename = fromHeader(new URL(res.url).searchParams.get("b2ContentDisposition"));
    } catch {}
  }
  const total = res.headers.get("content-range")?.match(/\/(\d+)$/)?.[1] ?? res.headers.get("content-length");
  const sizeBytes = total && Number(total) > 1 ? Number(total) : null;
  return { filename, sizeBytes };
}

async function civitaiApi<T>(host: string, pathName: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (config.civitaiToken) headers.authorization = `Bearer ${config.civitaiToken}`;
  // civitai.red (NSFW) und civitai.com haben dieselbe API – bei Fehler die andere probieren
  const hosts = [host, host === "civitai.com" ? "civitai.red" : "civitai.com"];
  let last: unknown;
  for (const h of hosts) {
    try {
      const res = await fetch(`https://${h}${pathName}`, { headers, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return (await res.json()) as T;
      last = new CivitaiApiError(res.status);
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("Civitai nicht erreichbar");
}

export async function resolveLink(input: string, versionOverride?: number): Promise<Resolved> {
  const link = parseModelLink(input);
  if (!link) throw new Error("Link nicht erkannt. Erlaubt: Civitai-Modellseite/Download-Link, Hugging Face (resolve/blob) oder direkter Link.");

  if (link.kind === "civitai") {
    let versionId = versionOverride ?? link.versionId;
    let versions: { id: number; name: string }[] | undefined;
    let title = "";
    if (link.modelId) {
      try {
        const model = await civitaiApi<{ name: string; type: string; modelVersions: { id: number; name: string }[] }>(
          link.host,
          `/api/v1/models/${link.modelId}`,
        );
        versions = model.modelVersions.map((v) => ({ id: v.id, name: v.name }));
        versionId ??= versions[0]?.id;
        title = model.name;
      } catch (err) {
        // Mit modelVersionId im Link geht es über den Download-Link weiter
        if (!versionId)
          throw new Error(
            `${err instanceof Error ? err.message : "Civitai-Infos nicht verfügbar."} Nimm stattdessen den Download-Link (auf Civitai beim Download-Knopf „Link kopieren“).`,
          );
      }
    }
    if (!versionId) throw new Error("Keine Version gefunden");
    let v: CivitaiVersion;
    try {
      v = await civitaiApi<CivitaiVersion>(link.host, `/api/v1/model-versions/${versionId}`);
    } catch (err) {
      // Info-Schnittstelle gesperrt/kaputt → direkt über den Download-Link weitermachen
      const dlUrl = `https://${link.host}/api/download/models/${versionId}${link.fileId ? `?fileId=${link.fileId}` : ""}`;
      const probe = await probeDownload(dlUrl);
      const filename = probe.filename ? (sanitizeModelFilename(probe.filename) ?? probe.filename) : `civitai_${versionId}.safetensors`;
      return {
        source: "civitai",
        title: probe.filename ?? `Civitai ${versionId}`,
        versionId,
        tokenMissing: !config.civitaiToken,
        notice: `${err instanceof Error ? err.message : "Civitai-Infos nicht verfügbar."} Dateiname und Größe kommen direkt vom Download – bitte den Ordner selbst wählen.`,
        files: [
          {
            url: dlUrl,
            filename,
            sizeBytes: probe.sizeBytes,
            type: guessTypeFromPath(filename),
            label: "Civitai-Download",
            primary: true,
          },
        ],
      };
    }
    const modelType = v.model?.type ?? "Checkpoint";
    let files = v.files;
    if (link.fileId && !versionOverride) files = files.filter((f) => f.id === link.fileId);
    return {
      source: "civitai",
      title: `${title || v.model?.name || "Civitai"} – ${v.name}`,
      baseModel: v.baseModel,
      versions,
      versionId: v.id,
      tokenMissing: !config.civitaiToken,
      files: files.map((f) => ({
        // Download immer über den Host aus dem Link (civitai.red für NSFW-Modelle)
        url: f.downloadUrl.replace(/^https:\/\/[^/]+/, `https://${link.host}`),
        filename: sanitizeModelFilename(f.name) ?? f.name,
        sizeBytes: Math.round(f.sizeKB * 1024),
        type: civitaiType(modelType, f.type, v.baseModel),
        label: `${f.type}${f.primary ? " (Haupt-Datei)" : ""}`,
        primary: !!f.primary,
      })),
    };
  }

  // Hugging Face / direkt: Größe per HEAD ermitteln
  let sizeBytes: number | null = null;
  try {
    const headers: Record<string, string> = {};
    if (link.kind === "huggingface" && config.hfToken) headers.authorization = `Bearer ${config.hfToken}`;
    const res = await fetch(link.url, { method: "HEAD", headers, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const len = Number(res.headers.get("x-linked-size") || res.headers.get("content-length"));
    if (Number.isFinite(len) && len > 0) sizeBytes = len;
    if (res.status === 401 || res.status === 403) throw new Error(`Kein Zugriff (${res.status}) – HF_TOKEN gesetzt bzw. Lizenz akzeptiert?`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Kein Zugriff")) throw err;
  }
  return {
    source: link.kind,
    title: link.filename,
    tokenMissing: link.kind === "huggingface" && !config.hfToken,
    files: [
      {
        url: link.url,
        filename: sanitizeModelFilename(link.filename) ?? link.filename,
        sizeBytes,
        type: guessTypeFromPath(new URL(link.url).pathname),
        label: link.kind === "huggingface" ? "Hugging Face" : "Direkter Link",
        primary: true,
      },
    ],
  };
}

// --- Downloads ------------------------------------------------------------------------

export interface DownloadJob {
  id: string;
  filename: string;
  type: ModelType;
  folder: string;
  status: "running" | "done" | "error" | "cancelled";
  received: number;
  total: number | null;
  speed: number;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

const g = globalThis as unknown as { __podDownloads?: Map<string, { job: DownloadJob; abort: AbortController }> };
const jobs = (g.__podDownloads ??= new Map());

export function listDownloads(): DownloadJob[] {
  return [...jobs.values()].map((j) => j.job).sort((a, b) => b.startedAt - a.startedAt);
}

export function cancelDownload(id: string) {
  const entry = jobs.get(id);
  if (!entry) return;
  if (entry.job.status === "running") entry.abort.abort();
  else jobs.delete(id);
}

function authedUrl(raw: string): { url: string; headers: Record<string, string> } {
  const u = new URL(raw);
  const headers: Record<string, string> = {};
  if (/(^|\.)civitai\.(com|red|green)$/i.test(u.hostname) && config.civitaiToken) {
    // Token in der URL – ein Header geht beim Redirect zum Speicher verloren
    u.searchParams.set("token", config.civitaiToken);
  } else if (/(^|\.)huggingface\.co$/i.test(u.hostname) && config.hfToken) {
    headers.authorization = `Bearer ${config.hfToken}`;
  }
  return { url: u.toString(), headers };
}

export async function startDownload(input: { url: string; type: ModelType; filename: string; sizeBytes?: number | null }): Promise<DownloadJob> {
  const filename = sanitizeModelFilename(input.filename);
  if (!filename) throw new Error(`Ungültiger Dateiname „${input.filename}“ (Endung .safetensors/.pth/… nötig)`);
  if (!MODEL_TYPES[input.type]) throw new Error("Unbekannter Typ");
  const folder = MODEL_TYPES[input.type].folder;
  const dir = path.join(config.modelsDir, folder);
  const dest = path.join(dir, filename);
  if (!dest.startsWith(path.join(config.modelsDir, folder) + path.sep)) throw new Error("Ungültiger Pfad");

  await fs.mkdir(dir, { recursive: true });
  if (await fs.stat(dest).then(() => true, () => false)) throw new Error(`${folder}/${filename} gibt es schon`);
  for (const { job } of jobs.values())
    if (job.status === "running" && job.folder === folder && job.filename === filename) throw new Error("Läuft schon");

  if (input.sizeBytes) {
    const st = await fs.statfs(dir);
    const free = st.bavail * st.bsize;
    if (free < input.sizeBytes * 1.05)
      throw new Error(`Zu wenig Speicher: ${(free / 1e9).toFixed(1)} GB frei, ${(input.sizeBytes / 1e9).toFixed(1)} GB nötig`);
  }

  const job: DownloadJob = {
    id: randomUUID().slice(0, 8),
    filename,
    type: input.type,
    folder,
    status: "running",
    received: 0,
    total: input.sizeBytes ?? null,
    speed: 0,
    startedAt: Date.now(),
  };
  const abort = new AbortController();
  jobs.set(job.id, { job, abort });
  run(job, input.url, dest, abort.signal).catch(() => {});
  return job;
}

async function run(job: DownloadJob, rawUrl: string, dest: string, signal: AbortSignal) {
  const part = `${dest}.part`;
  try {
    const { url, headers } = authedUrl(rawUrl);
    // Abgebrochenen Download fortsetzen, falls .part schon da ist
    const existing = await fs.stat(part).then((s) => s.size, () => 0);
    if (existing > 0) headers.range = `bytes=${existing}-`;
    const res = await fetch(url, { headers, redirect: "follow", signal });
    if (!res.ok || !res.body) {
      const hint = res.status === 401 || res.status === 403 ? " – Token fehlt/ungültig oder Modell braucht Login" : "";
      throw new Error(`HTTP ${res.status}${hint}`);
    }
    const resumed = res.status === 206 && existing > 0;
    const len = Number(res.headers.get("content-length"));
    if (Number.isFinite(len) && len > 0) job.total = (resumed ? existing : 0) + len;
    job.received = resumed ? existing : 0;

    let windowStart = Date.now();
    let windowBytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        job.received += chunk.length;
        windowBytes += chunk.length;
        const now = Date.now();
        if (now - windowStart >= 1000) {
          job.speed = (windowBytes / (now - windowStart)) * 1000;
          windowStart = now;
          windowBytes = 0;
        }
        cb(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
      counter,
      createWriteStream(part, { flags: resumed ? "a" : "w" }),
      { signal },
    );
    if (job.total && job.received < job.total) throw new Error("Download unvollständig – nochmal starten (setzt fort)");
    // Fehlerseite statt Modell?
    if (job.received < 100_000) {
      await fs.rm(part, { force: true });
      throw new Error("Antwort ist kein Modell (zu klein) – Token/Link prüfen");
    }
    await fs.rename(part, dest);
    job.status = "done";
    clearNodeInfoCache();
  } catch (err) {
    if (signal.aborted) {
      job.status = "cancelled";
      await fs.rm(part, { force: true }).catch(() => {});
    } else {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
    }
  } finally {
    job.speed = 0;
    job.finishedAt = Date.now();
  }
}
