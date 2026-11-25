import { randomInt, randomUUID } from "node:crypto";
import { parseBatch, type BatchError } from "../batch";
import { buildWorkflow as buildAnima } from "../builders/anima";
import { buildWorkflow as buildKrea2 } from "../builders/krea2";
import { krea2Problems } from "../krea2";
import { buildWorkflow as buildH3, h3PromptText } from "../builders/h3";
import { buildWorkflow as buildWai } from "../builders/wai";
import { parseVideoBatch, settingsForItem } from "../h3batch";
import type { H3Settings, ImageSettings, JobRecord, PromptItem } from "../types";
import { type DetailerOptions, type InputSpec, adetailerWanted } from "../builders/detailer";
import { ComfyPromptError, comboValues, getNodeInfo, nodeExists, queuePrompt } from "./comfy";
import { getClientId, registerPromptNodes } from "./events";
import { ensureRefsOnPod } from "./refs";
import { refLimitError } from "../h3refs";
import { getAppSettings, saveBatch, saveJob } from "./store";
import { currentPod, serverMode, withRole } from "./podLink";

/** Pod, auf dem gerade eingereiht wird (Server-Modus) */
const podHere = () => (serverMode() ? currentPod()?.id : undefined);

export class BatchParseError extends Error {
  constructor(public errors: BatchError[]) {
    super(`${errors.length} fehlerhafte Prompt-Blöcke`);
  }
}

export function randomSeed() {
  return randomInt(0, 2 ** 32);
}

export function promptItems(s: ImageSettings, defaultNegative: string): PromptItem[] {
  // Krea 2: kein Negativ (CFG 1) – negative:-Zeilen im Batch werden ignoriert
  const noNegative = s.generator === "krea2";
  if (s.promptMode === "batch") {
    const { items, errors } = parseBatch(s.batchText, noNegative ? "" : s.negative.trim() || defaultNegative, { ignoreNegative: noNegative });
    if (errors.length) throw new BatchParseError(errors);
    if (!items.length) throw new BatchParseError([{ block: 0, message: "Keine Prompts gefunden" }]);
    return items;
  }
  if (!s.positive.trim()) throw new BatchParseError([{ block: 0, message: "Positiver Prompt ist leer" }]);
  return [{ positive: s.positive.trim(), negative: noNegative ? "" : s.negative.trim() || defaultNegative, name: "bild" }];
}

export interface SubmitResult {
  batchId: string;
  promptIds: string[];
  seeds: number[];
  failed: { name: string; error: string; node_errors?: unknown }[];
}

/**
 * Stellt ALLE Blöcke sofort serverseitig in die ComfyUI-Queue. Dadurch läuft der
 * Batch weiter, auch wenn das Handy gesperrt oder der Tab zu ist.
 */
export function submitImageJobs(input: ImageSettings): Promise<SubmitResult> {
  // Bilder auf den Bild-Pod (bei nur einem Pod: der eine)
  return withRole("bild", () => submitImageJobsHere(input));
}

export class PreflightError extends Error {
  constructor(public problems: string[]) {
    super(problems.join(" · "));
  }
}

/** Krea 2: Dateien, CLIPLoader-Typ „krea2“ und LoraLoaderModelOnly vor dem Start prüfen. */
async function assertKrea2Ready(s: ImageSettings) {
  const [unet, clip, vae, modelOnly] = await Promise.all(["UNETLoader", "CLIPLoader", "VAELoader", "LoraLoaderModelOnly"].map((n) => getNodeInfo(n)));
  const problems = krea2Problems(s, {
    unets: comboValues(unet, "unet_name"),
    clips: comboValues(clip, "clip_name"),
    vaes: comboValues(vae, "vae_name"),
    clipTypes: comboValues(clip, "type"),
    modelOnlyLoras: !!modelOnly,
  });
  if (problems.length) throw new PreflightError(problems);
}

async function submitImageJobsHere(input: ImageSettings): Promise<SubmitResult> {
  const app = await getAppSettings();
  const settings = { ...input, folder: input.folder.trim() || app.folders[input.generator] };
  const items = promptItems(settings, app.defaultNegative);
  const clientId = getClientId();

  let shiftNode: "ModelSamplingAuraFlow" | "ModelSamplingSD3" | null = null;
  if (settings.generator === "anima" && settings.shiftEnabled) {
    shiftNode = (await nodeExists("ModelSamplingAuraFlow"))
      ? "ModelSamplingAuraFlow"
      : (await nodeExists("ModelSamplingSD3"))
        ? "ModelSamplingSD3"
        : null;
  }

  if (settings.generator === "krea2") await assertKrea2Ready(settings);
  const detailer = settings.generator !== "krea2" && adetailerWanted(settings) ? await detailerOptions(settings) : undefined;

  const batchId = randomUUID().replace(/-/g, "").slice(0, 16);
  const result: SubmitResult = { batchId, promptIds: [], seeds: [], failed: [] };

  for (const [index, prompt] of items.entries()) {
    const seed = settings.seed ?? randomSeed();
    const input = { settings, prompt, seed };
    const wf =
      settings.generator === "krea2"
        ? buildKrea2(input)
        : settings.generator === "anima"
          ? buildAnima(input, { shiftNode, detailer })
          : buildWai(input, { detailer });
    try {
      const promptId = await queuePrompt(wf, clientId);
      registerPromptNodes(promptId, wf);
      result.promptIds.push(promptId);
      result.seeds.push(seed);
      const job: JobRecord = {
        promptId,
        podId: podHere(),
        kind: "image",
        generator: settings.generator,
        settings,
        prompt,
        seed,
        batchId: items.length > 1 ? batchId : undefined,
        index,
        label: prompt.name,
        createdAt: Date.now(),
      };
      await saveJob(job);
    } catch (err) {
      // Scheitert schon der erste Job (z. B. fehlende Modelldatei), scheitern alle → abbrechen
      if (index === 0) throw err;
      result.failed.push({
        name: prompt.name,
        error: err instanceof Error ? err.message : String(err),
        node_errors: err instanceof ComfyPromptError ? err.details.node_errors : undefined,
      });
    }
  }

  if (items.length > 1) {
    await saveBatch({
      id: batchId,
      generator: settings.generator,
      promptIds: result.promptIds,
      total: items.length,
      createdAt: Date.now(),
    });
  }
  return result;
}

export function submitVideoJob(input: H3Settings) {
  // Videos auf den Video-Pod (bei nur einem Pod: der eine)
  return withRole("video", () => submitVideoJobHere(input));
}

async function submitVideoJobHere(input: H3Settings) {
  // Alle Tabs werden nur zum Abschicken mitgeschickt – im Job nur die tatsächlich benutzten Refs
  const { refTabs: _t, refExtra: _e, ...settings } = input;
  await ensureRefsOnPod(settings.refs ?? []);
  const seed = settings.seed ?? randomSeed();
  const wf = buildH3({ settings, seed });
  const promptId = await queuePrompt(wf, getClientId());
  registerPromptNodes(promptId, wf);
  const text = h3PromptText(settings);
  await saveJob({
    promptId,
    podId: podHere(),
    kind: "video",
    generator: "h3",
    settings,
    seed,
    label: settings.clipName?.trim() || (settings.blocks.summary || text).slice(0, 60) || "Video",
    createdAt: Date.now(),
  });
  return { promptId, seed };
}

/**
 * Video-Batch: jeder Prompt ein eigener Job, alle sofort in die ComfyUI-Queue. Läuft weiter,
 * auch wenn das Handy gesperrt ist. Alle Clips teilen die Einstellungen; die Referenzen kommen aus
 * dem Ref-Tab des Clips („Ref-Tab 3“ über „Clip 35“), sonst aus dem gewählten Tab.
 */
export function submitVideoBatch(settings: H3Settings): Promise<SubmitResult> {
  return withRole("video", () => submitVideoBatchHere(settings));
}

async function submitVideoBatchHere(settings: H3Settings): Promise<SubmitResult> {
  const { items, errors } = parseVideoBatch(settings.batchText ?? "", {
    mode: settings.mode,
    noDialogue: settings.noDialogue,
    tabs: settings.refTabs,
    extra: settings.refExtra,
    defaultTab: settings.refTab,
  });
  if (errors.length) throw new BatchParseError(errors);
  if (!items.length) throw new BatchParseError([{ block: 0, message: "Keine Prompts gefunden" }]);
  const limit = settings.refTabs ? null : refLimitError(settings.refs ?? []);
  if (limit) throw new BatchParseError([{ block: 0, message: limit }]);
  // Refs aller benutzten Tabs vorab auf den Pod – fehlt eine, startet gar nichts (statt nachts abzubrechen)
  await ensureRefsOnPod(items.flatMap((it) => it.refs ?? settings.refs ?? []));
  const clientId = getClientId();
  const batchId = randomUUID().replace(/-/g, "").slice(0, 16);
  const result: SubmitResult = { batchId, promptIds: [], seeds: [], failed: [] };

  for (const [index, item] of items.entries()) {
    const itemSettings = settingsForItem(settings, item);
    const seed = settings.seed ?? randomSeed();
    const wf = buildH3({ settings: itemSettings, seed });
    const name = item.name || `Clip ${index + 1}`;
    try {
      const promptId = await queuePrompt(wf, clientId);
      registerPromptNodes(promptId, wf);
      result.promptIds.push(promptId);
      result.seeds.push(seed);
      await saveJob({
        promptId,
        podId: podHere(),
        kind: "video",
        generator: "h3",
        settings: itemSettings,
        seed,
        batchId: items.length > 1 ? batchId : undefined,
        index,
        label: item.name || item.preview.slice(0, 60) || name,
        createdAt: Date.now(),
      });
    } catch (err) {
      if (index === 0) throw err;
      result.failed.push({
        name,
        error: err instanceof Error ? err.message : String(err),
        node_errors: err instanceof ComfyPromptError ? err.details.node_errors : undefined,
      });
    }
  }

  if (items.length > 1) {
    await saveBatch({ id: batchId, generator: "h3", promptIds: result.promptIds, total: items.length, createdAt: Date.now() });
  }
  return result;
}

/** ADetailer: Eingänge und Erkennungsmodelle vom Pod holen – mit klarer Meldung, wenn etwas fehlt. */
async function detailerOptions(s: ImageSettings): Promise<DetailerOptions> {
  const [face, provider] = await Promise.all([getNodeInfo("FaceDetailer"), getNodeInfo("UltralyticsDetectorProvider")]);
  if (!face || !provider) throw new Error("ADetailer: Impact Pack bzw. Impact Subpack ist auf dem Pod nicht installiert (Setup „bilder“ oder „alles“ neu laufen lassen)");
  const detectors = comboValues(provider, "model_name");
  const faceModel = detectors.find((d) => /face/i.test(d)) ?? null;
  const handModel = detectors.find((d) => /hand/i.test(d)) ?? null;
  if (s.adetailer && !faceModel) throw new Error("ADetailer: Gesichts-Erkennung (face_yolov8m.pt) fehlt auf dem Pod");
  if (s.adetailerHands && !handModel) throw new Error("ADetailer: Hand-Erkennung (hand_yolov8s.pt) fehlt auf dem Pod");
  return { spec: (face.input?.required ?? null) as InputSpec | null, faceModel, handModel };
}
