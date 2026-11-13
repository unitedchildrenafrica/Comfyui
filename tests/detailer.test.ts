import { describe, expect, it } from "vitest";
import { buildWorkflow as buildAnima } from "@/lib/builders/anima";
import { validateWorkflow } from "@/lib/builders/common";
import { defaultsFromSpec } from "@/lib/builders/detailer";
import { buildWorkflow as buildWai } from "@/lib/builders/wai";
import { defaultImageSettings } from "@/lib/defaults";

// Auszug wie /object_info/FaceDetailer (Impact Pack, input.required)
const SPEC = {
  image: ["IMAGE"],
  model: ["MODEL", { tooltip: "…" }],
  clip: ["CLIP"],
  vae: ["VAE"],
  guide_size: ["FLOAT", { default: 512 }],
  guide_size_for: ["BOOLEAN", { default: true }],
  max_size: ["FLOAT", { default: 1024 }],
  seed: ["INT", { default: 0 }],
  steps: ["INT", { default: 20 }],
  cfg: ["FLOAT", { default: 8 }],
  sampler_name: [["euler", "euler_ancestral"]],
  scheduler: [["normal", "karras"]],
  positive: ["CONDITIONING"],
  negative: ["CONDITIONING"],
  denoise: ["FLOAT", { default: 0.5 }],
  feather: ["INT", { default: 5 }],
  noise_mask: ["BOOLEAN", { default: true }],
  force_inpaint: ["BOOLEAN", { default: true }],
  bbox_threshold: ["FLOAT", { default: 0.5 }],
  bbox_dilation: ["INT", { default: 10 }],
  bbox_crop_factor: ["FLOAT", { default: 3 }],
  sam_detection_hint: [["center-1", "horizontal-2"]],
  sam_dilation: ["INT", { default: 0 }],
  sam_threshold: ["FLOAT", { default: 0.93 }],
  sam_bbox_expansion: ["INT", { default: 0 }],
  sam_mask_hint_threshold: ["FLOAT", { default: 0.7 }],
  sam_mask_hint_use_negative: [["False", "Small", "Outter"]],
  drop_size: ["INT", { default: 10 }],
  bbox_detector: ["BBOX_DETECTOR"],
  wildcard: ["STRING", { multiline: true }],
  cycle: ["INT", { default: 1 }],
};
const DET = { spec: SPEC, faceModel: "bbox/face_yolov8m.pt", handModel: "bbox/hand_yolov8s.pt" };
const prompt = { positive: "1girl", negative: "bad hands", name: "bild_001" };

describe("ADetailer", () => {
  it("füllt alle Pflicht-Eingänge (Standardwerte vom Pod, Listen → erster Eintrag)", () => {
    const d = defaultsFromSpec(SPEC);
    expect(d.sam_detection_hint).toBe("center-1");
    expect(d.sam_mask_hint_use_negative).toBe("False");
    expect(d.wildcard).toBe("");
    expect(d.cycle).toBe(1);
    expect(d.model).toBeUndefined(); // Links kommen aus dem Workflow
  });

  it("WAI: Gesicht + Hände hängen vor dem Speichern, alle Links gültig", () => {
    const s = { ...defaultImageSettings("pony"), adetailer: true, adetailerHands: true, adetailerDenoise: 0.4, adetailerHandDenoise: 0.5 };
    const wf = buildWai({ settings: s, prompt, seed: 42 }, { detailer: DET });
    expect(validateWorkflow(wf)).toEqual([]);
    expect(wf["15"].inputs.images).toEqual(["971", 0]);
    expect(wf["971"].inputs.image).toEqual(["970", 0]);
    expect(wf["970"].inputs.image).toEqual(["14", 0]); // nach dem Hochskalieren
    expect(wf["960"].inputs.model_name).toBe("bbox/face_yolov8m.pt");
    expect(wf["961"].inputs.model_name).toBe("bbox/hand_yolov8s.pt");
    expect(wf["970"].inputs.denoise).toBe(0.4);
    expect(wf["971"].inputs.denoise).toBe(0.5);
    expect(wf["970"].inputs.seed).toBe(42);
    // gleiche Modelle/Prompts wie der Sampler (inkl. LoRA-Kette)
    expect(wf["970"].inputs.model).toEqual(wf["7"].inputs.model);
    expect(wf["970"].inputs.positive).toEqual(["4", 0]);
    for (const k of Object.keys(SPEC)) expect(wf["970"].inputs[k], k).toBeDefined();
  });

  it("ohne Hochskalieren direkt nach dem ersten Decode; aus = unverändert", () => {
    const base = defaultImageSettings("wai");
    const s = { ...base, adetailer: true, upscale: { ...base.upscale, enabled: false } };
    const wf = buildWai({ settings: s, prompt, seed: 1 }, { detailer: DET });
    expect(wf["970"].inputs.image).toEqual(["8", 0]);
    expect(validateWorkflow(wf)).toEqual([]);
    const plain = buildWai({ settings: base, prompt, seed: 1 });
    expect(plain["970"]).toBeUndefined();
  });

  it("Anima funktioniert genauso", () => {
    const s = { ...defaultImageSettings("anima"), adetailerHands: true };
    const wf = buildAnima({ settings: s, prompt, seed: 7 }, { detailer: DET });
    expect(validateWorkflow(wf)).toEqual([]);
    expect(wf["15"].inputs.images).toEqual(["971", 0]);
    expect(wf["970"]).toBeUndefined();
  });

  it("fehlt die Erkennung auf dem Pod → klare Fehlermeldung", () => {
    const s = { ...defaultImageSettings("wai"), adetailerHands: true };
    expect(() => buildWai({ settings: s, prompt, seed: 1 }, { detailer: { ...DET, handModel: null } })).toThrow(/Hände/);
  });
});
