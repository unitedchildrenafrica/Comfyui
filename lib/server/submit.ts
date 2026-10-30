import { randomInt, randomUUID } from "node:crypto";
import { parseBatch, type BatchError } from "../batch";
import { buildWorkflow as buildAnima } from "../builders/anima";
import { buildWorkflow as buildH3, h3PromptText } from "../builders/h3";
import { buildWorkflow as buildWai } from "../builders/wai";
import type { H3Settings, ImageSettings, JobRecord, PromptItem } from "../types";
import { ComfyPromptError, nodeExists, queuePrompt } from "./comfy";
import { getClientId, registerPromptNodes } from "./events";
import { getAppSettings, saveBatch, saveJob } from "./store";

export class BatchParseError extends Error {
  constructor(public errors: BatchError[]) {
    super(`${errors.length} fehlerhafte Prompt-Blöcke`);
  }
}

export function randomSeed() {
  return randomInt(0, 2 ** 32);
}

export function promptItems(s: ImageSettings, defaultNegative: string): PromptItem[] {
  if (s.promptMode === "batch") {
    const { items, errors } = parseBatch(s.batchText, s.negative.trim() || defaultNegative);
    if (errors.length) throw new BatchParseError(errors);
    if (!items.length) throw new BatchParseError([{ block: 0, message: "Keine Prompts gefunden" }]);
    return items;
  }
  if (!s.positive.trim()) throw new BatchParseError([{ block: 0, message: "Positiver Prompt ist leer" }]);
  return [{ positive: s.positive.trim(), negative: s.negative.trim() || defaultNegative, name: "bild" }];
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
export async function submitImageJobs(input: ImageSettings): Promise<SubmitResult> {
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

  const batchId = randomUUID().replace(/-/g, "").slice(0, 16);
  const result: SubmitResult = { batchId, promptIds: [], seeds: [], failed: [] };

  for (const [index, prompt] of items.entries()) {
    const seed = settings.seed ?? randomSeed();
    const input = { settings, prompt, seed };
    const wf = settings.generator === "anima" ? buildAnima(input, { shiftNode }) : buildWai(input);
    try {
      const promptId = await queuePrompt(wf, clientId);
      registerPromptNodes(promptId, wf);
      result.promptIds.push(promptId);
      result.seeds.push(seed);
      const job: JobRecord = {
        promptId,
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

export async function submitVideoJob(settings: H3Settings) {
  const seed = settings.seed ?? randomSeed();
  const wf = buildH3({ settings, seed });
  const promptId = await queuePrompt(wf, getClientId());
  registerPromptNodes(promptId, wf);
  const text = h3PromptText(settings);
  await saveJob({
    promptId,
    kind: "video",
    generator: "h3",
    settings,
    seed,
    label: settings.clipName?.trim() || (settings.blocks.summary || text).slice(0, 60) || "Video",
    createdAt: Date.now(),
  });
  return { promptId, seed };
}
