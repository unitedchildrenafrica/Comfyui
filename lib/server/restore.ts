import { promises as fs } from "node:fs";
import { type ModelLists, type ModelStatus, type RestoreSet, groupSets, jobModels, lookup, uniqueModels } from "../restore";
import { getHistory } from "./history";
import { deletedMap, isDeleted, listMirrored } from "./mirror";
import { findLink, getModelLinks } from "./modelRegistry";
import { getOptions } from "./options";
import { serverMode } from "./podLink";
import { listJobs } from "./store";
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

export async function listRestoreSets(tzOffsetMin: number): Promise<{ sets: RestoreSet[]; podOnline: boolean }> {
  const [jobs, present, lists, links] = await Promise.all([listJobs(), presentPromptIds(), podModelLists(), getModelLinks()]);
  const byId = new Map(jobs.map((j) => [j.promptId, j]));
  const sets = groupSets(jobs, present, tzOffsetMin).map((s) => {
    const needs = uniqueModels(s.promptIds.flatMap((id) => jobModels(byId.get(id)!)));
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
export async function jobsForSets(keys: string[], tzOffsetMin: number) {
  const jobs = await listJobs();
  const byId = new Map(jobs.map((j) => [j.promptId, j]));
  const want = new Set(keys);
  return groupSets(jobs, new Set(), tzOffsetMin)
    .filter((s) => want.has(s.key))
    .reverse()
    .map((s) => s.promptIds.map((id) => byId.get(id)!));
}
