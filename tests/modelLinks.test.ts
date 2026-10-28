import { describe, expect, it } from "vitest";
import { civitaiType, guessTypeFromPath, parseModelLink, sanitizeModelFilename } from "@/lib/modelLinks";

describe("parseModelLink", () => {
  it("Civitai-Varianten", () => {
    expect(parseModelLink("https://civitai.com/models/827184/wai-illustrious-sdxl?modelVersionId=1367422")).toEqual({
      kind: "civitai",
      host: "civitai.com",
      modelId: 827184,
      versionId: 1367422,
    });
    expect(parseModelLink("https://civitai.red/models/827184")).toEqual({ kind: "civitai", host: "civitai.red", modelId: 827184, versionId: undefined });
    expect(parseModelLink("https://civitai.red/api/download/models/2945208?fileId=2824391&token=x")).toEqual({
      kind: "civitai",
      host: "civitai.red",
      versionId: 2945208,
      fileId: 2824391,
    });
    expect(parseModelLink("https://www.civitai.com/images/123")).toBeNull();
  });

  it("Hugging Face blob → resolve", () => {
    expect(parseModelLink("https://huggingface.co/Comfy-Org/MiniMax-H3/blob/main/vae/minimax_h3_video_vae_fp16.safetensors")).toEqual({
      kind: "huggingface",
      url: "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors",
      filename: "minimax_h3_video_vae_fp16.safetensors",
    });
    expect(parseModelLink("https://huggingface.co/Comfy-Org/MiniMax-H3")).toBeNull();
  });

  it("direkt und ungültig", () => {
    expect(parseModelLink("https://example.com/a/b/model.safetensors")?.kind).toBe("direct");
    expect(parseModelLink("ftp://x/y")).toBeNull();
    expect(parseModelLink("kein link")).toBeNull();
  });
});

describe("Typen und Dateinamen", () => {
  it("civitaiType", () => {
    expect(civitaiType("Checkpoint", "Model", "Illustrious")).toBe("checkpoint");
    expect(civitaiType("Checkpoint", "Model", "Anima")).toBe("unet");
    expect(civitaiType("Checkpoint", "Text Encoder", "Anima")).toBe("text_encoder");
    expect(civitaiType("Checkpoint", "VAE", "Anima")).toBe("vae");
    expect(civitaiType("LORA", "Model", "Pony")).toBe("lora");
  });

  it("guessTypeFromPath", () => {
    expect(guessTypeFromPath("loras/minimax_h3_turbo.safetensors")).toBe("lora");
    expect(guessTypeFromPath("vae/x.safetensors")).toBe("vae");
    expect(guessTypeFromPath("4x_foolhardy_Remacri.pth")).toBe("upscaler");
    expect(guessTypeFromPath("model.safetensors")).toBeNull();
  });

  it("sanitizeModelFilename", () => {
    expect(sanitizeModelFilename("waiIllustriousSDXL_v100.safetensors")).toBe("waiIllustriousSDXL_v100.safetensors");
    expect(sanitizeModelFilename("mein modell.safetensors")).toBe("mein_modell.safetensors");
    expect(sanitizeModelFilename("../../etc/passwd")).toBeNull();
    expect(sanitizeModelFilename("x.exe")).toBeNull();
    expect(sanitizeModelFilename(".hidden.safetensors")).toBeNull();
  });
});
