import { promises as fs } from "node:fs";
import path from "node:path";
import { type JobLite, type ModelLists, type ModelStatus, type RestoreSet, groupSets, lookup, summarizeJob } from "../restore";
import type { JobRecord } from "../types";
import { config } from "./config";
import { getHistory } from "./history";
import { deletedMap, isDeleted, listMirrored } from "./mirror";
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

export async function listRestoreSets(tzOffsetMin: number): Promise<{ sets: RestoreSet[]; podOnline: boolean }> {
  const [jobs, present, lists, links] = await Promise.all([jobSummaries(), presentPromptIds(), podModelLists(), getModelLinks()]);
  const sets = groupSets(jobs, present, tzOffsetMin).map(({ needs, promptIds: _ids, ...s }) => {
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

/** Jobs der gewählten Sets, in Set-Reihenfolge (ältestes Set zuerst, damit die Queue chronologisch ist) */
export async function jobsForSets(keys: string[], tzOffsetMin: number): Promise<JobRecord[][]> {
  const want = new Set(keys);
  const chosen = groupSets(await jobSummaries(), new Set(), tzOffsetMin)
    .filter((s) => want.has(s.key))
    .reverse();
  const out: JobRecord[][] = [];
  // nur die gewählten Jobs ganz laden
  for (const s of chosen) {
    const jobs = (await Promise.all(s.promptIds.map((id) => getJob(id)))).filter((j): j is JobRecord => !!j);
    if (jobs.length) out.push(jobs);
  }
  return out;
}
