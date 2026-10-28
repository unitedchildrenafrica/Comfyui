import template from "@/workflows/workflow_ANIMA_TensorHub.json";
import { type ApiWorkflow, assertValid, clone, node } from "./common";
import { type ImageJobInput, applyCommon, applyUpscale, insertLoraChain } from "./hires";

export type ShiftNodeClass = "ModelSamplingAuraFlow" | "ModelSamplingSD3";

export interface AnimaOptions {
  /**
   * Node-Klasse für Sampling Shift. Die API-Route wählt sie anhand von /object_info:
   * ModelSamplingAuraFlow bevorzugt, sonst ModelSamplingSD3 (beide: Eingänge model + shift).
   * TODO(pod-test): Gegen den echten Pod mit anima-base-v1.0 prüfen, welche Klasse korrekte
   * Bilder liefert, und das Ergebnis hier notieren.
   */
  shiftNode?: ShiftNodeClass | null;
}

/** Anima (UNet + Qwen3-Text-Encoder + Qwen-VAE). */
export function buildWorkflow(input: ImageJobInput, opts: AnimaOptions = {}): ApiWorkflow {
  const s = input.settings;
  const wf = clone(template) as unknown as ApiWorkflow;
  applyCommon(wf, input, "anima");

  node(wf, "60").inputs.unet_name = s.unet;
  node(wf, "61").inputs.clip_name = s.textEncoder; // type bleibt qwen_image
  node(wf, "62").inputs.vae_name = s.vae;

  let { model, clip } = insertLoraChain(wf, s.loras, ["60", 0], ["61", 0]);
  node(wf, "4").inputs.clip = clip;
  node(wf, "5").inputs.clip = clip;

  const shiftNode = opts.shiftNode === undefined ? "ModelSamplingAuraFlow" : opts.shiftNode;
  if (s.shiftEnabled && shiftNode) {
    wf["700"] = { class_type: shiftNode, inputs: { shift: s.shift, model }, _meta: { title: "Sampling Shift" } };
    model = ["700", 0];
  }
  node(wf, "7").inputs.model = model;
  node(wf, "13").inputs.model = model;

  applyUpscale(wf, s);
  return assertValid(wf);
}
