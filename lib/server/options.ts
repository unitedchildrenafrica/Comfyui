import { classifyLora, type LoraUse } from "../loraKinds";
import { comboValues, getNodeInfo } from "./comfy";
import { getLoraOverrides } from "./loraKinds";

export const H3_REQUIRED_NODES = [
  "MiniMaxH3Director",
  "MiniMaxH3DirectorGuide",
  "DaSiWa_EnhancedVideoCombine",
  "DaSiWa_LTX2LoraLoader",
  "DaSiWa_SeedControl",
  "DaSiWaH3ContinuityAppend",
  "DaSiWaH3ContinuityPublish",
] as const;

export interface Options {
  checkpoints: string[];
  loras: string[];
  /** Bild / Video / beide pro LoRA, null = noch nicht zugeordnet */
  loraUse: Record<string, { use: LoraUse | null; auto: boolean }>;
  vaes: string[];
  upscalers: string[];
  samplers: string[];
  schedulers: string[];
  unets: string[];
  clips: string[];
  h3: {
    modes: string[];
    samplers: string[];
    schedulers: string[];
    missingNodes: string[];
    interpolationAvailable: boolean;
    livePreviewAvailable: boolean;
  };
  available: {
    faceDetailer: boolean;
    shiftNode: "ModelSamplingAuraFlow" | "ModelSamplingSD3" | null;
  };
}

/** Alle Dropdown-Inhalte live aus /object_info (nie hart codiert). */
export async function getOptions(): Promise<Options> {
  const names = [
    "CheckpointLoaderSimple",
    "LoraLoader",
    "VAELoader",
    "UpscaleModelLoader",
    "KSampler",
    "UNETLoader",
    "CLIPLoader",
    "FaceDetailer",
    "ModelSamplingAuraFlow",
    "ModelSamplingSD3",
    "KSamplerSelect",
    "BasicScheduler",
    "FrameInterpolationModelLoader",
    "ModelPreviewOverrideKJ",
    ...H3_REQUIRED_NODES,
  ];
  const infos = await Promise.all(names.map((n) => getNodeInfo(n)));
  const info = Object.fromEntries(names.map((n, i) => [n, infos[i]]));
  const loras = comboValues(info.LoraLoader, "lora_name");
  const overrides = await getLoraOverrides();

  return {
    checkpoints: comboValues(info.CheckpointLoaderSimple, "ckpt_name"),
    loras,
    loraUse: Object.fromEntries(loras.map((l) => [l, classifyLora(l, overrides)])),
    vaes: comboValues(info.VAELoader, "vae_name"),
    upscalers: comboValues(info.UpscaleModelLoader, "model_name"),
    samplers: comboValues(info.KSampler, "sampler_name"),
    schedulers: comboValues(info.KSampler, "scheduler"),
    unets: comboValues(info.UNETLoader, "unet_name"),
    clips: comboValues(info.CLIPLoader, "clip_name"),
    h3: {
      modes: comboValues(info.MiniMaxH3Director, "mode"),
      samplers: comboValues(info.KSamplerSelect, "sampler_name"),
      schedulers: comboValues(info.BasicScheduler, "scheduler"),
      missingNodes: H3_REQUIRED_NODES.filter((n) => !info[n]),
      interpolationAvailable: !!info.FrameInterpolationModelLoader,
      livePreviewAvailable: !!info.ModelPreviewOverrideKJ,
    },
    available: {
      faceDetailer: !!info.FaceDetailer,
      shiftNode: info.ModelSamplingAuraFlow ? "ModelSamplingAuraFlow" : info.ModelSamplingSD3 ? "ModelSamplingSD3" : null,
    },
  };
}
