import template from "@/workflows/MiniMaxH3WF.json";
import { buildH3Prompt } from "../h3prompt";
import type { H3Settings } from "../types";
import { type ApiWorkflow, assertValid, clone, node, removeNodes } from "./common";

export interface H3JobInput {
  settings: H3Settings;
  seed: number;
}

export const H3_MAX_LORAS = 10;
export const H3_MAX_IMAGES = 9;
export const H3_MAX_AUDIO = 3;

export function h3PromptText(s: H3Settings): string {
  return s.promptInput === "blocks" && s.mode === "REF2VA" ? buildH3Prompt(s.blocks) : s.fullPrompt.trim();
}

/**
 * Timeline-Items im Schema von MiniMaxH3Director (ComfyUI-DaSiWa-Nodes,
 * nodes/nodes_minimax_h3_director.py): {type, value, slot, order, enabled}.
 * `value` ist ein Pfad relativ zum ComfyUI-input-Ordner. Sortiert wird nach Typ,
 * dann slot – daraus ergeben sich die Tags <Picture 1>, <Audio 1> … im Prompt.
 * In FL2VA ist slot 0 das erste und slot 1 das letzte Bild, in I2VA zählt nur slot 0.
 */
export function timelineItems(s: H3Settings) {
  const counters = { image: 0, audio: 0 };
  return s.refs
    .filter((r) => r.filename)
    .map((r, order) => {
      const item: Record<string, unknown> = {
        id: `pf_${r.kind}_${order}`,
        type: r.kind,
        value: r.filename,
        slot: counters[r.kind]++,
        order,
        enabled: true,
      };
      if (r.kind === "audio") {
        if (r.trimStart) item.trim_start = r.trimStart;
        if (r.trimEnd) item.trim_end = r.trimEnd;
      }
      return item;
    });
}

export function buildWorkflow({ settings: s, seed }: H3JobInput): ApiWorkflow {
  const wf = clone(template) as unknown as ApiWorkflow;
  const prompt = h3PromptText(s);

  // Wichtig: Der Director nimmt den Prompt aus builder_state. Ist der leer, holt er
  // sich resolved_prompt aus timeline_data (im Export = leeres Gerüst) – das
  // prompt-Widget allein würde ignoriert. Deshalb alle drei Stellen setzen und
  // den „simple“-Modus nutzen, der den Text 1:1 übernimmt.
  const builderState = {
    version: 2,
    mode: s.mode,
    duration: s.duration,
    prompt_mode: "simple",
    simple_prompt: prompt,
    ref: {
      subject_definitions: s.blocks.subject_definitions,
      summary: s.blocks.summary,
      retention_analysis: s.blocks.retention_analysis,
      detailed_description: s.blocks.detailed_description,
      soundscape: s.blocks.overall_soundscape,
      music: s.blocks.non_diegetic_music || "N/A",
    },
  };
  const director = node(wf, "2730").inputs;
  const timeline = JSON.parse(String(director.timeline_data));
  timeline.items = timelineItems(s);
  timeline.builder_state = builderState;
  timeline.resolved_prompt = prompt;
  Object.assign(director, {
    mode: s.mode,
    prompt,
    width: s.width,
    height: s.height,
    duration: s.duration,
    frame_rate: s.frameRate,
    builder_state: JSON.stringify(builderState),
    timeline_data: JSON.stringify(timeline),
  });

  Object.assign(node(wf, "2739").inputs, {
    seed_value: seed,
    seed_control_state: JSON.stringify({ mode: "fixed", last_seed: String(seed), recent: [String(seed)] }),
  });

  Object.assign(node(wf, "1512:2590").inputs, { steps: s.steps, scheduler: s.scheduler });
  node(wf, "1512:2598").inputs.sampler_name = s.sampler;
  node(wf, "1512:2586").inputs.unet_name = s.ditModel;
  node(wf, "1512:2588").inputs.unet_name = s.ditModel;
  node(wf, "1512:2587").inputs.clip_name = s.textEncoder;

  const slots = Array.from({ length: H3_MAX_LORAS }, (_, i) => {
    const l = s.loras.filter((x) => x.enabled && x.name && x.name !== "None")[i];
    return l
      ? { on: true, lora: l.name, str: l.strength, vs: 1, as: 1 }
      : { on: true, lora: "None", str: 1, vs: 1, as: 1 };
  });
  node(wf, "2678").inputs.stack_data = JSON.stringify(slots);

  if (!s.interpolation) {
    removeNodes(wf, ["1512:2714", "1512:2715"]);
    node(wf, "2568").inputs.images = ["1512:2671", 0];
    node(wf, "1512:2717").inputs.expression = "a"; // sonst doppelte Ausgabe-FPS
  }
  if (!s.livePreview) {
    removeNodes(wf, ["2737"]);
    node(wf, "1512:2592").inputs.model = ["2678", 0];
  }
  node(wf, "2568").inputs.quality = s.quality;

  return assertValid(wf);
}
