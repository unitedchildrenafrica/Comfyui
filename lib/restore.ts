// „Gelöschte Sets neu generieren“: reine Hilfsfunktionen (Client + Server).
//
// Jeder abgeschickte Job liegt mit Prompt, Seed und allen Einstellungen in DATA_DIR/jobs – auch wenn
// die Bilder/Videos gelöscht sind. Daraus werden hier Sets (ein Batch = ein Set, Einzelbilder je Ordner
// und Tag) und die Liste der benötigten Modelle.

import type { ModelType } from "./modelLinks";
import { findAvailable } from "./notes";
import type { H3Settings, ImageSettings, JobRecord } from "./types";

export type PodRoleName = "bild" | "video";

export interface ModelNeed {
  name: string;
  type: ModelType;
  role: PodRoleName;
}

/** Was auf dem Pod liegt, je Rolle und Modelltyp */
export type ModelLists = Record<PodRoleName, Partial<Record<ModelType, string[]>>>;

export type ModelStatus = "here" | "link" | "missing" | "unknown";

export interface RestoreSet {
  key: string;
  kind: "image" | "video";
  generator: JobRecord["generator"];
  folder: string;
  /** erster Job des Sets */
  createdAt: number;
  jobs: number;
  /** Bilder pro Job (batchSize), für die Anzeige „40 Bilder“ */
  perJob: number;
  /** Jobs, von denen noch Dateien in der Galerie sind */
  present: number;
  /** Jobs, die schon einmal neu gestartet wurden */
  restored: number;
  preview: string;
  names: string[];
  promptIds: string[];
  models: (ModelNeed & { status: ModelStatus; url?: string })[];
}

export const jobFolder = (job: JobRecord) => (job.kind === "video" ? "video" : (job.settings as ImageSettings).folder || job.generator);

/** Anima und Krea 2: UNet + Text-Encoder + VAE statt Checkpoint.
 *  Alle Modelle, die ein Job braucht – mit dem Namen, wie er im Job steht */
export function jobModels(job: JobRecord): ModelNeed[] {
  const out: ModelNeed[] = [];
  if (job.kind === "video") {
    const s = job.settings as H3Settings;
    const add = (name: string | undefined, type: ModelType) => name && name !== "None" && out.push({ name, type, role: "video" });
    add(s.ditModel, "unet");
    add(s.textEncoder, "text_encoder");
    for (const l of s.loras ?? []) if (l.enabled) add(l.name, "lora");
    return out;
  }
  const s = job.settings as ImageSettings;
  const add = (name: string | undefined, type: ModelType) => name && out.push({ name, type, role: "bild" });
  if (s.generator === "anima" || s.generator === "krea2") {
    add(s.unet, "unet");
    add(s.textEncoder, "text_encoder");
    add(s.vae, "vae");
  } else {
    add(s.checkpoint, "checkpoint");
    if (s.vae && s.vae !== "auto") add(s.vae, "vae");
  }
  for (const l of s.loras ?? []) if (l.enabled) add(l.name, "lora");
  if (s.upscale?.enabled && s.upscale.upscaler && s.upscale.upscaler !== "lanczos") add(s.upscale.upscaler, "upscaler");
  return out;
}

const needKey = (m: ModelNeed) => `${m.role}|${m.type}|${m.name}`;

export function uniqueModels(list: ModelNeed[]): ModelNeed[] {
  const seen = new Map<string, ModelNeed>();
  for (const m of list) if (!seen.has(needKey(m))) seen.set(needKey(m), m);
  return [...seen.values()];
}

/** Name auf dem Pod (auch wenn er dort in einem anderen Unterordner liegt), null = fehlt, undefined = unbekannt */
export function lookup(lists: ModelLists | null, m: ModelNeed): string | null | undefined {
  const list = lists?.[m.role]?.[m.type];
  if (!list) return undefined;
  return findAvailable(m.name, list);
}

/**
 * Einstellungen eines Jobs auf die Dateinamen des aktuellen Pods umstellen (Modell kann nach dem
 * Neu-Laden in einem anderen Unterordner liegen). missing = Modelle, die der Pod nicht hat.
 */
export function remapJobModels<T extends ImageSettings | H3Settings>(job: JobRecord & { settings: T }, lists: ModelLists): { settings: T; missing: ModelNeed[] } {
  const settings = structuredClone(job.settings) as T;
  const missing: ModelNeed[] = [];
  const map = (name: string, type: ModelType, role: PodRoleName): string => {
    const m = { name, type, role };
    const found = lookup(lists, m);
    if (found === null) missing.push(m);
    return found ?? name;
  };
  if (job.kind === "video") {
    const s = settings as H3Settings;
    if (s.ditModel) s.ditModel = map(s.ditModel, "unet", "video");
    if (s.textEncoder) s.textEncoder = map(s.textEncoder, "text_encoder", "video");
    s.loras = (s.loras ?? []).map((l) => (l.enabled && l.name && l.name !== "None" ? { ...l, name: map(l.name, "lora", "video") } : l));
  } else {
    const s = settings as ImageSettings;
    if (s.generator === "anima" || s.generator === "krea2") {
      if (s.unet) s.unet = map(s.unet, "unet", "bild");
      if (s.textEncoder) s.textEncoder = map(s.textEncoder, "text_encoder", "bild");
      if (s.vae) s.vae = map(s.vae, "vae", "bild");
    } else {
      if (s.checkpoint) s.checkpoint = map(s.checkpoint, "checkpoint", "bild");
      if (s.vae && s.vae !== "auto") s.vae = map(s.vae, "vae", "bild");
    }
    s.loras = (s.loras ?? []).map((l) => (l.enabled && l.name ? { ...l, name: map(l.name, "lora", "bild") } : l));
    if (s.upscale?.enabled && s.upscale.upscaler && s.upscale.upscaler !== "lanczos") s.upscale = { ...s.upscale, upscaler: map(s.upscale.upscaler, "upscaler", "bild") };
  }
  return { settings, missing: uniqueModels(missing) };
}

/** Schlüssel des Sets, zu dem ein Job gehört: Batch, sonst Einzelbilder je Ordner und Tag */
export function setKey(job: JobRecord, tzOffsetMin = 0): string {
  if (job.batchId) return `b:${job.batchId}`;
  const day = new Date(job.createdAt - tzOffsetMin * 60_000).toISOString().slice(0, 10);
  return `s:${job.kind}:${jobFolder(job)}:${day}`;
}

/**
 * Jobs zu Sets zusammenfassen, neueste zuerst. present = prompt_ids mit Dateien in der Galerie.
 * Neu gestartete Jobs (restoredFrom) zählen beim Original als „schon neu gestartet“.
 */
export function groupSets(jobs: JobRecord[], present: Set<string>, tzOffsetMin = 0): Omit<RestoreSet, "models">[] {
  const restoredFrom = new Set(jobs.map((j) => j.restoredFrom).filter(Boolean) as string[]);
  // Neu gestartete Kopien nicht als eigenes Set zeigen, solange das Original da ist –
  // sonst stehen sie während der Queue als „gelöscht“ da und werden doppelt gestartet
  const ids = new Set(jobs.map((j) => j.promptId));
  const visible = jobs.filter((j) => !j.restoredFrom || !ids.has(j.restoredFrom));
  const groups = new Map<string, JobRecord[]>();
  for (const j of [...visible].sort((a, b) => a.createdAt - b.createdAt || (a.index ?? 0) - (b.index ?? 0))) {
    const k = setKey(j, tzOffsetMin);
    const g = groups.get(k);
    if (g) g.push(j);
    else groups.set(k, [j]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const first = list[0];
      const img = first.kind === "image" ? (first.settings as ImageSettings) : null;
      const preview =
        first.prompt?.positive ??
        (first.kind === "video" ? videoPreview(first.settings as H3Settings) : "") ??
        first.label;
      return {
        key,
        kind: first.kind,
        generator: first.generator,
        folder: jobFolder(first),
        createdAt: first.createdAt,
        jobs: list.length,
        perJob: img ? Math.max(1, img.batchSize || 1) : 1,
        present: list.filter((j) => present.has(j.promptId)).length,
        restored: list.filter((j) => restoredFrom.has(j.promptId)).length,
        preview: (preview || first.label || "").slice(0, 300),
        names: list.map((j) => j.label),
        promptIds: list.map((j) => j.promptId),
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function videoPreview(s: H3Settings): string {
  return (s.blocks?.summary || s.fullPrompt || "").trim();
}
