import template from "@/workflows/workflow_KREA2_Turbo.json";
import { type ApiWorkflow, assertValid, clone, node, roundTo } from "./common";
import { KREA2_MULTIPLE } from "../krea2";
import { type ImageJobInput, applyCommon, applyUpscale, insertModelLoraChain } from "./hires";

/**
 * Krea 2 Turbo (12B-DiT, Text-Encoder Qwen3-VL-4B, Qwen-Image-VAE).
 *
 * Template = Kern des offiziellen Comfy-Templates image_krea2_turbo_t2i.json (Subgraph aufgelöst,
 * ohne Prompt-Verbesserung, Schalter und Stil-LoRA), im Node-Layout der TensorHub-Templates:
 *   60 UNETLoader · 61 CLIPLoader (type krea2) · 62 VAELoader
 *   4 CLIPTextEncode (positiv, = KSampler 7.positive) · 5 ConditioningZeroOut (negativ, CFG 1)
 *   6 EmptyLatentImage · 7 KSampler · 8 VAEDecode
 *   Hires wie WAI/Anima: 41 UpscaleModelLoader · 40 ImageUpscaleWithModel · 11 ImageScale ·
 *   12 VAEEncode · 13 KSampler · 14 VAEDecode · 15 SaveImage
 * Kein Shift-Node: das Template nutzt den Standard des Modells.
 */
export const KREA2_POSITIVE_NODE = "4";

export function buildWorkflow(input: ImageJobInput): ApiWorkflow {
  const s = input.settings;
  const settings = { ...s, width: roundTo(s.width, KREA2_MULTIPLE), height: roundTo(s.height, KREA2_MULTIPLE) };
  const wf = clone(template) as unknown as ApiWorkflow;
  applyCommon(wf, { ...input, settings }, "krea2", { negative: false });

  node(wf, "60").inputs.unet_name = s.unet;
  node(wf, "61").inputs.clip_name = s.textEncoder; // type bleibt krea2
  node(wf, "62").inputs.vae_name = s.vae;

  const model = insertModelLoraChain(wf, s.loras, ["60", 0]);
  node(wf, "7").inputs.model = model;
  node(wf, "13").inputs.model = model;

  applyUpscale(wf, settings, KREA2_MULTIPLE);
  return assertValid(wf);
}
