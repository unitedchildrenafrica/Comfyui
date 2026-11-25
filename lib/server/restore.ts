import { promises as fs } from "node:fs";
import path from "node:path";
import { type JobLite, type ModelLists, type ModelStatus, type RestoreSet, dedupeJobs, groupSets, lookup, summarizeJob } from "../restore";
import type { JobRecord } from "../types";
import { config } from "./config";
import { getHistory } from "./history";
import { deletedMap, isDeleted, listMirrored, mirroredPromptIds } from "./mirror";
import { findLink, getModelLinks } from "./modelRegistry";
import { getOptions } from "./options";
import { serverMode } from "./podLink";
import { getJob } from "./store";
import { resolveOutputFile } from "./zip";

/** Modelllisten der Pods (Bild-Pod / Video-Pod). null = kein Pod erreichbar */
export async function podModelLists(): Promise<ModelLists | null> {
  try {
    const o = await getOptions();
    // Ohne erreichbaren Pod sind alle Listen leer – dann „unbekannt“ statt „fehlt“.
    // Sampler gibt es auf jedem laufenden Pod, daran erkennt man ihn.
    const bildOn = o.samplers.length > 0;
    const videoOn = o.h3.samplers.length > 0;
    if (!bildOn && !videoOn) return null;
    return {
      bild: bildOn ? { checkpoint: o.checkpoints, lora: o.loras, vae: o.vaes, upscaler: o.upscalers, unet: o.unets, text_encoder: o.clips } : {},
      video: videoOn ? { unet: o.h3.unets, text_encoder: o.h3.clips, lora: o.h3.loras } : {},
    };
  } catch {
    return null;
  }
}

/** prompt_ids, von denen noch mindestens eine Datei in der Galerie ist */
async function presentPromptIds(): Promise<Set<string>> {
  const out = new Set<string>();
  if (serverMode()) {
    for (const m of await listMirrored()) out.add(m.promptId);
    // noch nicht gespiegelte Dateien eines laufenden Pods
    try {
      const deletedAt = await deletedMap();
      for (const e of await getHistory(2000))
        if (e.files.some((f) => f.type === "output" && !isDeleted(deletedAt, f, e.timestamp))) out.add(e.promptId);
    } catch {}
    return out;
  }
  try {
    for (const e of await getHistory(2000)) {
      for (const f of e.files) {
        if (f.type !== "output") continue;
        const abs = resolveOutputFile(f.subfolder, f.filename);
        if (abs && (await fs.access(abs).then(() => true, () => false))) {
          out.add(e.promptId);
          break;
        }
      }
    }
  } catch {}
  return out;
}

// Zusammenfassungen je Job-Datei, gemerkt nach Änderungszeit und Größe. So wird jede Datei nur
// einmal gelesen und nie alle Jobs gleichzeitig ganz im Speicher gehalten (alte Batch-Jobs
// enthalten den kompletten Batch-Text – zusammen leicht Hunderte MB → Absturz, HTTP 502).
const g = globalThis as unknown as { __jobLite?: Map<string, { mtimeMs: number; size: number; lite: JobLite | null }> };
const liteCache = (g.__jobLite ??= new Map());

export async function jobSummaries(): Promise<JobLite[]> {
  const dir = config.dataPath("jobs");
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const seen = new Set(names);
  for (const k of liteCache.keys()) if (!seen.has(k)) liteCache.delete(k);
  // in kleinen Häppchen – höchstens ein paar Dateien gleichzeitig im Speicher
  for (let i = 0; i < names.length; i += 16) {
    await Promise.all(
      names.slice(i, i + 16).map(async (name) => {
        const abs = path.join(dir, name);
        const st = await fs.stat(abs).catch(() => null);
        if (!st) return;
        const hit = liteCache.get(name);
        if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return;
        let lite: JobLite | null = null;
        try {
          const job = JSON.parse(await fs.readFile(abs, "utf8")) as JobRecord;
          if (job?.promptId && job.settings && typeof job.createdAt === "number") lite = summarizeJob(job);
        } catch {}
        liteCache.set(name, { mtimeMs: st.mtimeMs, size: st.size, lite });
      }),
    );
  }
  return [...liteCache.values()].map((v) => v.lite).filter((l): l is JobLite => !!l);
}

/** Fertig gewordene Jobs: im Server-Modus aus dem Spiegel, sonst unbekannt */
async function finishedPromptIds(): Promise<Set<string> | null> {
  if (!serverMode()) return null;
  return mirroredPromptIds().catch(() => null);
}

export async function listRestoreSets(tzOffsetMin: number): Promise<{ sets: RestoreSet[]; podOnline: boolean }> {
  const [jobs, present, lists, links, finished] = await Promise.all([jobSummaries(), presentPromptIds(), podModelLists(), getModelLinks(), finishedPromptIds()]);
  const sets = groupSets(jobs, present, tzOffsetMin, finished).map(({ needs, promptIds: _ids, ...s }) => {
    const models = needs.map((m) => {
      const found = lookup(lists, m);
      const link = findLink(links, m.name);
      const status: ModelStatus = found === undefined ? "unknown" : found ? "here" : link ? "link" : "missing";
      return { ...m, status, ...(link && status !== "here" ? { url: link.url } : {}) };
    });
    return { ...s, models };
  });
  return { sets, podOnline: !!lists };
}

export interface RestorePlan {
  /** je gewähltem Set die Jobs, die gestartet werden (ältestes Set zuerst) */
  groups: string[][];
  jobs: number;
  /** wegen gleicher Ausgabedatei übersprungen */
  skipped: number;
}

/** Was „Neu generieren“ starten würde – mit dedupe jede Ausgabedatei nur einmal */
export async function planRestore(keys: string[], tzOffsetMin: number, dedupe: boolean): Promise<RestorePlan> {
  const want = new Set(keys);
  const lites = await jobSummaries();
  const chosen = groupSets(lites, new Set(), tzOffsetMin)
    .filter((s) => want.has(s.key))
    .reverse();
  const all = chosen.flatMap((s) => s.promptIds);
  let keep: Set<string> = new Set(all);
  if (dedupe) {
    const byId = new Map(lites.map((l) => [l.promptId, l]));
    keep = dedupeJobs(all.map((id) => byId.get(id)!), await finishedPromptIds());
  }
  const groups = chosen.map((s) => s.promptIds.filter((id) => keep.has(id))).filter((g) => g.length);
  const jobs = groups.reduce((n, g) => n + g.length, 0);
  return { groups, jobs, skipped: all.length - jobs };
}

/** Jobs eines Plans ganz laden (nur die gewählten) */
export async function loadPlan(plan: RestorePlan): Promise<JobRecord[][]> {
  const out: JobRecord[][] = [];
  for (const ids of plan.groups) {
    const jobs = (await Promise.all(ids.map((id) => getJob(id)))).filter((j): j is JobRecord => !!j);
    if (jobs.length) out.push(jobs);
  }
  return out;
}
