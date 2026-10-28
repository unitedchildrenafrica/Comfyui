import type { ImageSettings, LoraEntry, PromptItem } from "../types";
import { type ApiWorkflow, type Ref, node, removeNodes, safeFolder, scaledSize } from "./common";

export interface ImageJobInput {
  settings: ImageSettings;
  prompt: PromptItem;
  seed: number;
}

/** Gemeinsame Werte der TensorHub-Templates (WAI und Anima haben dieselben Node-IDs). */
export function applyCommon(wf: ApiWorkflow, { settings: s, prompt, seed }: ImageJobInput, defaultFolder: string) {
  // Inspire-Batch-Nodes (ohne class_type) und ihre Eingaben raus, Batching macht die App
  removeNodes(wf, ["2", "3", "30", "31", "50"]);

  node(wf, "4").inputs.text = prompt.positive;
  node(wf, "5").inputs.text = prompt.negative;

  Object.assign(node(wf, "6").inputs, {
    width: s.width,
    height: s.height,
    batch_size: Math.min(4, Math.max(1, Math.round(s.batchSize))),
  });

  const sampling = { seed, cfg: s.cfg, sampler_name: s.sampler, scheduler: s.scheduler };
  Object.assign(node(wf, "7").inputs, sampling, { steps: s.steps });
  Object.assign(node(wf, "13").inputs, sampling, { steps: s.upscale.steps, denoise: s.upscale.denoise });

  node(wf, "15").inputs.filename_prefix = `${safeFolder(s.folder, defaultFolder)}/${prompt.name}`;
}

/** Hochskalieren an/aus, Faktor, Modell oder Lanczos. */
export function applyUpscale(wf: ApiWorkflow, s: ImageSettings) {
  const up = s.upscale;
  if (!up.enabled) {
    removeNodes(wf, ["40", "41", "11", "12", "13", "14"]);
    node(wf, "15").inputs.images = ["8", 0];
    return;
  }
  Object.assign(node(wf, "11").inputs, scaledSize(s.width, s.height, up.factor));
  if (up.upscaler === "lanczos") {
    removeNodes(wf, ["40", "41"]);
    node(wf, "11").inputs.image = ["8", 0];
  } else {
    node(wf, "41").inputs.model_name = up.upscaler;
  }
}

/** Setzt die VAE auf alle Decode/Encode-Nodes, die (noch) existieren. */
export function rewireVae(wf: ApiWorkflow, vae: Ref) {
  for (const id of ["8", "12", "14"]) if (wf[id]) wf[id].inputs.vae = vae;
}

/** Hängt eine LoraLoader-Kette ein und liefert die neuen Ausgänge (model, clip). */
export function insertLoraChain(wf: ApiWorkflow, loras: LoraEntry[], model: Ref, clip: Ref) {
  let i = 0;
  for (const lora of loras) {
    if (!lora.enabled || !lora.name || lora.name === "None") continue;
    const id = `900${i++}`;
    wf[id] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: lora.name,
        strength_model: lora.strength,
        strength_clip: lora.strength,
        model,
        clip,
      },
      _meta: { title: `LoRA ${i}` },
    };
    model = [id, 0];
    clip = [id, 1];
  }
  return { model, clip };
}
