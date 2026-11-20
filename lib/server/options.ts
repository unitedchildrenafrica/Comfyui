import { classifyLora, type LoraUse } from "../loraKinds";
import { comboValues, getNodeInfo } from "./comfy";
import { withRole } from "./podLink";
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
    /** Video-Pod: DiT-Modelle, Text-Encoder, LoRAs (bei zwei Pods andere als auf dem Bild-Pod) */
    unets: string[];
    clips: string[];
    loras: string[];
    modes: string[];
    samplers: string[];
    schedulers: string[];
    missingNodes: string[];
    interpolationAvailable: boolean;
    livePreviewAvailable: boolean;
  };
  /** Erkennungsmodelle für den ADetailer, z. B. „bbox/face_yolov8m.pt“ */
  detectors: string[];
  available: {
    faceDetailer: boolean;
    shiftNode: "ModelSamplingAuraFlow" | "ModelSamplingSD3" | null;
  };
}

const IMAGE_NODES = [
  "CheckpointLoaderSimple",
  "LoraLoader",
  "VAELoader",
  "UpscaleModelLoader",
  "KSampler",
  "UNETLoader",
  "CLIPLoader",
  "FaceDetailer",
  "UltralyticsDetectorProvider",
  "ModelSamplingAuraFlow",
  "ModelSamplingSD3",
];
const VIDEO_NODES = [
  "UNETLoader",
  "CLIPLoader",
  "LoraLoader",
  "KSamplerSelect",
  "BasicScheduler",
  "FrameInterpolationModelLoader",
  "ModelPreviewOverrideKJ",
  ...H3_REQUIRED_NODES,
];

async function infos(names: string[]) {
  const list = await Promise.all(names.map((n) => getNodeInfo(n)));
  return Object.fromEntries(names.map((n, i) => [n, list[i]]));
}

/**
 * Alle Dropdown-Inhalte live aus /object_info (nie hart codiert). Bei zwei Pods kommen die Bild-
 * Listen vom Bild-Pod und die Video-Listen vom Video-Pod; bei einem Pod ist es derselbe.
 */
export async function getOptions(): Promise<Options> {
  const [info, vid] = await Promise.all([withRole("bild", () => infos(IMAGE_NODES)), withRole("video", () => infos(VIDEO_NODES))]);
  const loras = comboValues(info.LoraLoader, "lora_name");
  const videoLoras = comboValues(vid.LoraLoader, "lora_name");
  const overrides = await getLoraOverrides();

  return {
    checkpoints: comboValues(info.CheckpointLoaderSimple, "ckpt_name"),
    loras,
    loraUse: Object.fromEntries([...new Set([...loras, ...videoLoras])].map((l) => [l, classifyLora(l, overrides)])),
    vaes: comboValues(info.VAELoader, "vae_name"),
    upscalers: comboValues(info.UpscaleModelLoader, "model_name"),
    samplers: comboValues(info.KSampler, "sampler_name"),
    schedulers: comboValues(info.KSampler, "scheduler"),
    unets: comboValues(info.UNETLoader, "unet_name"),
    clips: comboValues(info.CLIPLoader, "clip_name"),
    h3: {
      unets: comboValues(vid.UNETLoader, "unet_name"),
      clips: comboValues(vid.CLIPLoader, "clip_name"),
      loras: videoLoras,
      modes: comboValues(vid.MiniMaxH3Director, "mode"),
      samplers: comboValues(vid.KSamplerSelect, "sampler_name"),
      schedulers: comboValues(vid.BasicScheduler, "scheduler"),
      missingNodes: H3_REQUIRED_NODES.filter((n) => !vid[n]),
      interpolationAvailable: !!vid.FrameInterpolationModelLoader,
      livePreviewAvailable: !!vid.ModelPreviewOverrideKJ,
    },
    detectors: comboValues(info.UltralyticsDetectorProvider, "model_name"),
    available: {
      // braucht Impact Pack (FaceDetailer) und Impact Subpack (Erkennung)
      faceDetailer: !!info.FaceDetailer && !!info.UltralyticsDetectorProvider,
      shiftNode: info.ModelSamplingAuraFlow ? "ModelSamplingAuraFlow" : info.ModelSamplingSD3 ? "ModelSamplingSD3" : null,
    },
  };
}
