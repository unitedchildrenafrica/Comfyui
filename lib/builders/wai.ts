import template from "@/workflows/workflow_WAI_TensorHub.json";
import { type ApiWorkflow, type Ref, assertValid, clone, node } from "./common";
import { type ImageJobInput, applyCommon, applyUpscale, insertLoraChain, rewireVae } from "./hires";

/** WAI / Pony (SDXL/Illustrious-Checkpoint). */
export function buildWorkflow(input: ImageJobInput): ApiWorkflow {
  const s = input.settings;
  const wf = clone(template) as unknown as ApiWorkflow;
  applyCommon(wf, input, s.generator === "pony" ? "pony" : "wai");

  node(wf, "1").inputs.ckpt_name = s.checkpoint;
  node(wf, "70").inputs.stop_at_clip_layer = -Math.max(1, Math.round(s.clipSkip));

  const { model, clip } = insertLoraChain(wf, s.loras, ["1", 0], ["1", 1]);
  node(wf, "7").inputs.model = model;
  node(wf, "13").inputs.model = model;
  node(wf, "70").inputs.clip = clip;

  applyUpscale(wf, s);

  let vae: Ref = ["1", 2];
  if (s.vae && s.vae !== "auto") {
    wf["800"] = { class_type: "VAELoader", inputs: { vae_name: s.vae }, _meta: { title: "VAE" } };
    vae = ["800", 0];
  }
  rewireVae(wf, vae);

  return assertValid(wf);
}
