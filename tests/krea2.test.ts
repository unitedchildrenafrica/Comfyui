import { describe, expect, it } from "vitest";
import { KREA2_FILES, defaultImageSettings } from "@/lib/defaults";
import { krea2LoraSum, krea2Problems, krea2StartupWarning } from "@/lib/krea2";

const lists = {
  // neuer Pod: pod/setup.sh lädt das Standard-Modell (LUSTIFY! v10)
  unets: [KREA2_FILES.unet],
  clips: ["qwen3vl_4b_fp8_scaled.safetensors"],
  vaes: ["qwen_image_vae.safetensors"],
  clipTypes: ["stable_diffusion", "qwen_image", "krea2"],
  modelOnlyLoras: true,
};

describe("Krea 2: Prüfungen vor dem Start", () => {
  it("alles da → keine Probleme", () => {
    expect(krea2Problems(defaultImageSettings("krea2"), lists)).toEqual([]);
  });

  it("meldet fehlenden Typ krea2 und fehlende Dateien", () => {
    const p = krea2Problems({ ...defaultImageSettings("krea2"), unet: "anderes.safetensors" }, { ...lists, clipTypes: ["qwen_image"] });
    expect(p).toHaveLength(2);
    expect(p[0]).toMatch(/zu alt/);
    expect(p[1]).toMatch(/UNet: Datei fehlt auf dem Pod: anderes/);
  });

  it("Startparameter: SageAttention und --fast warnen, normaler Start nicht", () => {
    expect(krea2StartupWarning(["main.py", "--listen", "0.0.0.0", "--reserve-vram", "1.0"])).toBeNull();
    expect(krea2StartupWarning(["main.py", "--use-sage-attention"])).toMatch(/schwarze Bilder/);
    expect(krea2StartupWarning(["main.py", "--fast", "fp16_accumulation"])).toMatch(/--fast/);
    expect(krea2StartupWarning(undefined)).toBeNull();
  });

  it("LoRA-Summe zählt nur aktive", () => {
    expect(
      krea2LoraSum([
        { name: "a", strength: 0.8, enabled: true },
        { name: "b", strength: 1, enabled: false },
        { name: "c", strength: 0.9, enabled: true },
      ]),
    ).toBeCloseTo(1.7);
  });
});
