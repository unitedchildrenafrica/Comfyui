import { describe, expect, it } from "vitest";
import { buildWorkflow as buildWai } from "@/lib/builders/wai";
import { buildWorkflow as buildAnima } from "@/lib/builders/anima";
import { buildWorkflow as buildH3 } from "@/lib/builders/h3";
import { KREA2_POSITIVE_NODE, buildWorkflow as buildKrea2 } from "@/lib/builders/krea2";
import kreaTemplate from "@/workflows/workflow_KREA2_Turbo.json";
import { validateWorkflow, isRef, type ApiWorkflow } from "@/lib/builders/common";
import { defaultH3Settings, defaultImageSettings } from "@/lib/defaults";
import type { ImageSettings } from "@/lib/types";

const prompt = { positive: "1girl, solo", negative: "lowres", name: "bild_001" };

function refsOk(wf: ApiWorkflow) {
  expect(validateWorkflow(wf)).toEqual([]);
  for (const n of Object.values(wf)) {
    expect(n.class_type).toBeTruthy();
    for (const v of Object.values(n.inputs)) if (isRef(v)) expect(wf[v[0]]).toBeDefined();
  }
}

function wai(over: Partial<ImageSettings> = {}) {
  return { ...defaultImageSettings("wai"), ...over };
}

describe("WAI builder", () => {
  it("entfernt Inspire-Nodes und setzt Prompt/Prefix", () => {
    const wf = buildWai({ settings: wai(), prompt, seed: 42 });
    refsOk(wf);
    for (const id of ["2", "3", "30", "31", "50"]) expect(wf[id]).toBeUndefined();
    expect(wf["4"].inputs.text).toBe("1girl, solo");
    expect(wf["5"].inputs.text).toBe("lowres");
    expect(wf["15"].inputs.filename_prefix).toBe("wai/bild_001");
    expect(wf["7"].inputs.seed).toBe(42);
    expect(wf["13"].inputs.seed).toBe(42);
    expect(wf["70"].inputs.stop_at_clip_layer).toBe(-2);
  });

  it("rechnet die Hires-Größe auf Vielfache von 8", () => {
    const wf = buildWai({ settings: wai({ upscale: { ...wai().upscale, factor: 1.5 } }), prompt, seed: 1 });
    expect(wf["11"].inputs.width).toBe(1152);
    expect(wf["11"].inputs.height).toBe(1728);
    const odd = buildWai({ settings: wai({ width: 832, height: 1216, upscale: { ...wai().upscale, factor: 1.3 } }), prompt, seed: 1 });
    expect((odd["11"].inputs.width as number) % 8).toBe(0);
    expect((odd["11"].inputs.height as number) % 8).toBe(0);
  });

  it("Hochskalieren aus → Save hängt an Decode 1", () => {
    const wf = buildWai({ settings: wai({ upscale: { ...wai().upscale, enabled: false } }), prompt, seed: 1 });
    refsOk(wf);
    for (const id of ["40", "41", "11", "12", "13", "14"]) expect(wf[id]).toBeUndefined();
    expect(wf["15"].inputs.images).toEqual(["8", 0]);
  });

  it("Lanczos ohne Modell", () => {
    const wf = buildWai({ settings: wai({ upscale: { ...wai().upscale, upscaler: "lanczos" } }), prompt, seed: 1 });
    refsOk(wf);
    expect(wf["40"]).toBeUndefined();
    expect(wf["41"]).toBeUndefined();
    expect(wf["11"].inputs.image).toEqual(["8", 0]);
  });

  it("LoRA-Kette und eigene VAE", () => {
    const wf = buildWai({
      settings: wai({
        vae: "sdxl_vae.safetensors",
        loras: [
          { name: "a.safetensors", strength: 0.8, enabled: true },
          { name: "off.safetensors", strength: 1, enabled: false },
          { name: "b.safetensors", strength: 1.2, enabled: true },
        ],
      }),
      prompt,
      seed: 1,
    });
    refsOk(wf);
    expect(wf["9000"].inputs.model).toEqual(["1", 0]);
    expect(wf["9001"].inputs.model).toEqual(["9000", 0]);
    expect(wf["9001"].inputs.clip).toEqual(["9000", 1]);
    expect(wf["9002"]).toBeUndefined();
    expect(wf["7"].inputs.model).toEqual(["9001", 0]);
    expect(wf["13"].inputs.model).toEqual(["9001", 0]);
    expect(wf["70"].inputs.clip).toEqual(["9001", 1]);
    for (const id of ["8", "12", "14"]) expect(wf[id].inputs.vae).toEqual(["800", 0]);
  });

  it("eigene VAE ohne Hochskalieren", () => {
    const wf = buildWai({ settings: wai({ vae: "x.safetensors", upscale: { ...wai().upscale, enabled: false } }), prompt, seed: 1 });
    refsOk(wf);
    expect(wf["8"].inputs.vae).toEqual(["800", 0]);
  });

  it("Pony nutzt Ordner pony", () => {
    const wf = buildWai({ settings: { ...defaultImageSettings("pony"), checkpoint: "p.safetensors" }, prompt, seed: 1 });
    expect(wf["15"].inputs.filename_prefix).toBe("pony/bild_001");
  });

  it("weist unsichere Ordner zurück", () => {
    const wf = buildWai({ settings: wai({ folder: "../etc" }), prompt, seed: 1 });
    expect(wf["15"].inputs.filename_prefix).toBe("wai/bild_001");
  });
});

describe("Anima builder", () => {
  const anima = (over: Partial<ImageSettings> = {}) => ({ ...defaultImageSettings("anima"), ...over });

  it("Shift-Node zwischen UNet und Samplern", () => {
    const wf = buildAnima({ settings: anima(), prompt, seed: 7 });
    refsOk(wf);
    expect(wf["700"].class_type).toBe("ModelSamplingAuraFlow");
    expect(wf["700"].inputs.model).toEqual(["60", 0]);
    expect(wf["7"].inputs.model).toEqual(["700", 0]);
    expect(wf["13"].inputs.model).toEqual(["700", 0]);
    expect(wf["61"].inputs.type).toBe("qwen_image");
  });

  it("ModelSamplingSD3 als Alternative, Shift aus", () => {
    const sd3 = buildAnima({ settings: anima(), prompt, seed: 7 }, { shiftNode: "ModelSamplingSD3" });
    expect(sd3["700"].class_type).toBe("ModelSamplingSD3");
    const off = buildAnima({ settings: anima({ shiftEnabled: false }), prompt, seed: 7 });
    refsOk(off);
    expect(off["700"]).toBeUndefined();
    expect(off["7"].inputs.model).toEqual(["60", 0]);
  });

  it("LoRAs: model von 60, clip von 61", () => {
    const wf = buildAnima({ settings: anima({ loras: [{ name: "a", strength: 1, enabled: true }] }), prompt, seed: 7 });
    refsOk(wf);
    expect(wf["9000"].inputs.model).toEqual(["60", 0]);
    expect(wf["9000"].inputs.clip).toEqual(["61", 0]);
    expect(wf["700"].inputs.model).toEqual(["9000", 0]);
    expect(wf["4"].inputs.clip).toEqual(["9000", 1]);
    expect(wf["5"].inputs.clip).toEqual(["9000", 1]);
  });

  it("ohne Hochskalieren gültig", () => {
    const wf = buildAnima({ settings: anima({ upscale: { ...anima().upscale, enabled: false } }), prompt, seed: 7 });
    refsOk(wf);
  });
});

describe("H3 builder", () => {
  it("Standard ist gültig und setzt Werte", () => {
    const s = { ...defaultH3Settings(), seed: 5 };
    s.blocks.summary = "A cat walks.";
    const wf = buildH3({ settings: s, seed: 5 });
    refsOk(wf);
    expect(wf["1512:2586"].inputs.unet_name).toBe(s.ditModel);
    expect(wf["1512:2588"].inputs.unet_name).toBe(s.ditModel);
    expect(JSON.parse(wf["2739"].inputs.seed_control_state as string).mode).toBe("fixed");
    expect(wf["2739"].inputs.seed_value).toBe(5);
    const prompt = wf["2730"].inputs.prompt as string;
    expect(prompt).toContain("summary:\nA cat walks.");
    const builder = JSON.parse(wf["2730"].inputs.builder_state as string);
    expect(builder.prompt_mode).toBe("simple");
    expect(builder.simple_prompt).toBe(prompt);
    const timeline = JSON.parse(wf["2730"].inputs.timeline_data as string);
    expect(timeline.resolved_prompt).toBe(prompt);
    expect(timeline.continuity.session).toBeTruthy();
    expect(JSON.parse(wf["2678"].inputs.stack_data as string)).toHaveLength(10);
    // Continuity bleibt drin
    expect(wf["1512:2796"]).toBeDefined();
    expect(wf["2797"]).toBeDefined();
  });

  it("Video-Format: H.264 als Standard, Auto lässt das Template", () => {
    const wf = buildH3({ settings: defaultH3Settings(), seed: 1 });
    expect(wf["2568"].inputs).toMatchObject({ codec: "H.264", container: "MP4", bit_depth: "8-bit", audio_codec: "AAC" });
    const old = buildH3({ settings: { ...defaultH3Settings(), videoCodec: undefined }, seed: 1 });
    expect(old["2568"].inputs.codec).toBe("H.264");
    const auto = buildH3({ settings: { ...defaultH3Settings(), videoCodec: "Auto" }, seed: 1 });
    expect(auto["2568"].inputs).toMatchObject({ codec: "Auto", container: "Auto", bit_depth: "Auto", audio_codec: "Auto" });
  });

  it("Interpolation und Live-Vorschau aus", () => {
    const s = { ...defaultH3Settings(), interpolation: false, livePreview: false };
    const wf = buildH3({ settings: s, seed: 1 });
    refsOk(wf);
    expect(wf["1512:2714"]).toBeUndefined();
    expect(wf["1512:2715"]).toBeUndefined();
    expect(wf["2568"].inputs.images).toEqual(["1512:2671", 0]);
    expect(wf["1512:2717"].inputs.expression).toBe("a");
    expect(wf["2737"]).toBeUndefined();
    expect(wf["1512:2592"].inputs.model).toEqual(["2678", 0]);
  });

  it("LoRA-Slots und Refs", () => {
    const s = {
      ...defaultH3Settings(),
      loras: [{ name: "x.safetensors", strength: 0.7, enabled: true }],
      refs: [
        { kind: "image" as const, filename: "a.png" },
        { kind: "audio" as const, filename: "v.wav", trimEnd: 4 },
        { kind: "image" as const, filename: "b.png" },
      ],
    };
    const wf = buildH3({ settings: s, seed: 1 });
    const stack = JSON.parse(wf["2678"].inputs.stack_data as string);
    expect(stack[0]).toEqual({ on: true, lora: "x.safetensors", str: 0.7, vs: 1, as: 1 });
    expect(stack[1].lora).toBe("None");
    const items = JSON.parse(wf["2730"].inputs.timeline_data as string).items;
    expect(items.map((i: { type: string; slot: number }) => `${i.type}${i.slot}`)).toEqual(["image0", "audio0", "image1"]);
    expect(items[1].trim_end).toBe(4);
  });
});

describe("Krea 2 builder", () => {
  const krea = (over: Partial<ImageSettings> = {}) => ({ ...defaultImageSettings("krea2"), ...over });
  const kPrompt = { positive: "A photo of an adult woman by a window.", negative: "", name: "bild_001" };

  it("Template: Positiv-Node = KSampler.positive, Negativ = ConditioningZeroOut, CLIP-Typ krea2", () => {
    const t = kreaTemplate as unknown as ApiWorkflow;
    refsOk(t);
    expect(t["7"].inputs.positive).toEqual([KREA2_POSITIVE_NODE, 0]);
    expect(t["13"].inputs.positive).toEqual([KREA2_POSITIVE_NODE, 0]);
    expect(t[KREA2_POSITIVE_NODE].class_type).toBe("CLIPTextEncode");
    expect(t["5"].class_type).toBe("ConditioningZeroOut");
    expect(t["61"].inputs.type).toBe("krea2");
  });

  it("Standardwerte: 8 Schritte, CFG 1, euler/simple, 896×1152, Dateien, Prefix", () => {
    const wf = buildKrea2({ settings: krea(), prompt: kPrompt, seed: 7 });
    refsOk(wf);
    expect(wf["4"].inputs.text).toBe(kPrompt.positive);
    expect(wf["5"].inputs).toEqual({ conditioning: ["4", 0] });
    expect(wf["7"].inputs).toMatchObject({ seed: 7, steps: 8, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1, model: ["60", 0] });
    expect(wf["6"].inputs).toMatchObject({ width: 896, height: 1152, batch_size: 1 });
    expect(wf["60"].inputs.unet_name).toBe("lustify-v10-krea-turbo-fp8.safetensors");
    expect(wf["61"].inputs).toMatchObject({ clip_name: "qwen3vl_4b_fp8_scaled.safetensors", type: "krea2" });
    expect(wf["62"].inputs.vae_name).toBe("qwen_image_vae.safetensors");
    expect(wf["15"].inputs.filename_prefix).toBe("krea2/bild_001");
    // Hires an (Standard): 1.5x, auf 16 gerundet, 4 Schritte, Denoise 0.3
    expect(wf["11"].inputs).toMatchObject({ width: 1344, height: 1728 });
    expect(wf["13"].inputs).toMatchObject({ seed: 7, steps: 4, cfg: 1, denoise: 0.3 });
    expect(wf["15"].inputs.images).toEqual(["14", 0]);
  });

  it("Custom-Auflösung und Hires-Ziel auf Vielfache von 16", () => {
    const wf = buildKrea2({ settings: krea({ width: 1000, height: 1001, batchSize: 4, upscale: { ...krea().upscale, factor: 1.3 } }), prompt: kPrompt, seed: 1 });
    expect(wf["6"].inputs).toMatchObject({ width: 1008, height: 1008, batch_size: 4 });
    expect((wf["11"].inputs.width as number) % 16).toBe(0);
    expect((wf["11"].inputs.height as number) % 16).toBe(0);
  });

  it("LoRA-Kette aus LoraLoaderModelOnly zwischen UNet und beiden KSamplern", () => {
    const wf = buildKrea2({
      settings: krea({
        loras: [
          { name: "krea2_nsfw_v2.safetensors", strength: 0.8, enabled: true },
          { name: "aus.safetensors", strength: 1, enabled: false },
          { name: "krea2_turbo_nsfw.safetensors", strength: 0.5, enabled: true },
        ],
      }),
      prompt: kPrompt,
      seed: 1,
    });
    refsOk(wf);
    expect(wf["9000"]).toMatchObject({ class_type: "LoraLoaderModelOnly", inputs: { lora_name: "krea2_nsfw_v2.safetensors", strength_model: 0.8, model: ["60", 0] } });
    expect(wf["9001"]).toMatchObject({ class_type: "LoraLoaderModelOnly", inputs: { strength_model: 0.5, model: ["9000", 0] } });
    expect(wf["9001"].inputs.clip).toBeUndefined();
    expect(wf["9002"]).toBeUndefined();
    expect(wf["7"].inputs.model).toEqual(["9001", 0]);
    expect(wf["13"].inputs.model).toEqual(["9001", 0]);
    expect(wf["4"].inputs.clip).toEqual(["61", 0]);
  });

  it("ohne Hochskalieren und mit Lanczos gültig", () => {
    const off = buildKrea2({ settings: krea({ upscale: { ...krea().upscale, enabled: false } }), prompt: kPrompt, seed: 1 });
    refsOk(off);
    for (const id of ["40", "41", "11", "12", "13", "14"]) expect(off[id]).toBeUndefined();
    expect(off["15"].inputs.images).toEqual(["8", 0]);
    const lanczos = buildKrea2({ settings: krea({ upscale: { ...krea().upscale, upscaler: "lanczos" } }), prompt: kPrompt, seed: 1 });
    refsOk(lanczos);
    expect(lanczos["11"].inputs.image).toEqual(["8", 0]);
  });
});
