import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyLora, guessUseFromBaseModel, loraFits, SETUP_IMAGE_LORAS, SETUP_KREA_LORAS, SETUP_VIDEO_LORAS } from "@/lib/loraKinds";

const setup = readFileSync(path.join(import.meta.dirname, "../pod/setup.sh"), "utf8");

describe("LoRAs Bild/Video", () => {
  it("kennt genau die LoRAs aus pod/setup.sh", () => {
    const start = setup.indexOf("Bilder: Remacri-Upscaler + LoRAs");
    const kreaStart = setup.indexOf("Bilder: Krea 2", start);
    const imageSection = setup.slice(start, kreaStart);
    const image = [...imageSection.matchAll(/"\$M\/loras" (\S+\.safetensors)/g)].map((m) => m[1]);
    const kreaSection = setup.slice(kreaStart, setup.indexOf("if want video", kreaStart));
    const krea = [...kreaSection.matchAll(/"\$M\/loras" (\S+\.safetensors)/g)].map((m) => m[1]);
    const heredoc = setup.match(/<<'LORAS'\n([\s\S]*?)\nLORAS/)![1];
    const video = heredoc.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
    const turbo = [...setup.matchAll(/"\$M\/loras" (\S+\.safetensors)/g)].map((m) => m[1]).filter((n) => /minimax/i.test(n));
    expect(image.sort()).toEqual([...SETUP_IMAGE_LORAS].sort());
    expect(krea.sort()).toEqual([...SETUP_KREA_LORAS].sort());
    expect([...video, ...turbo].sort()).toEqual([...SETUP_VIDEO_LORAS].sort());
  });

  it("ordnet zu: eigene Wahl > Ordner > bekannt > Name", () => {
    expect(classifyLora("gothic_neon.safetensors").use).toBe("image");
    expect(classifyLora("CumOnFace.safetensors").use).toBe("video");
    expect(classifyLora("video/irgendwas.safetensors").use).toBe("video");
    expect(classifyLora("pony/irgendwas.safetensors").use).toBe("image");
    expect(classifyLora("my_h3_style.safetensors").use).toBe("video");
    expect(classifyLora("neu.safetensors").use).toBeNull();
    expect(classifyLora("sub/Neu.safetensors", { "neu.safetensors": "both" })).toEqual({ use: "both", auto: false });
    expect(classifyLora("gothic_neon.safetensors", { "gothic_neon.safetensors": "video" }).use).toBe("video");
  });

  it("filtert die Listen", () => {
    expect(loraFits("image", "video")).toBe(false);
    expect(loraFits("both", "video")).toBe(true);
    expect(loraFits(null, "image")).toBe(true);
  });

  it("rät beim Herunterladen aus dem Basismodell", () => {
    expect(guessUseFromBaseModel("Illustrious", "x.safetensors")).toBe("image");
    expect(guessUseFromBaseModel("Pony", "x.safetensors")).toBe("image");
    expect(guessUseFromBaseModel("MiniMax H3", "x.safetensors")).toBe("video");
    expect(guessUseFromBaseModel(undefined, "x.safetensors")).toBeNull();
    expect(guessUseFromBaseModel("Krea 2", "x.safetensors")).toBe("krea2");
    expect(guessUseFromBaseModel(undefined, "my_krea2_style.safetensors")).toBe("krea2");
  });
});

describe("LoRAs Krea 2", () => {
  it("erkennt Krea-LoRAs an Name, Ordner und Setup-Liste", () => {
    expect(classifyLora("krea2_nsfw_v2.safetensors").use).toBe("krea2");
    expect(classifyLora("krea2_aio_nsfw.safetensors").use).toBe("krea2");
    expect(classifyLora("krea/irgendwas.safetensors").use).toBe("krea2");
    expect(classifyLora("irgendwas.safetensors", { "irgendwas.safetensors": "krea2" })).toEqual({ use: "krea2", auto: false });
  });

  it("Krea-Liste zeigt nur Krea-LoRAs (plus nicht zugeordnete), andere Listen keine Krea-LoRAs", () => {
    expect(loraFits("krea2", "krea2")).toBe(true);
    expect(loraFits(null, "krea2")).toBe(true);
    expect(loraFits("image", "krea2")).toBe(false);
    expect(loraFits("both", "krea2")).toBe(false);
    expect(loraFits("video", "krea2")).toBe(false);
    expect(loraFits("krea2", "image")).toBe(false);
    expect(loraFits("krea2", "video")).toBe(false);
  });
});
