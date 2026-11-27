import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_MODEL_LINKS } from "@/lib/server/modelRegistry";

// Jede LoRA, die pod/setup.sh lädt, muss mit gleichem Link in der LoRA-Liste stehen.
const sh = readFileSync(path.join(__dirname, "..", "pod", "setup.sh"), "utf8");
const CV = "https://civitai.red/api/download/models";

function setupLoras(): { filename: string; url: string }[] {
  const out: { filename: string; url: string }[] = [];
  // civ "436219?fileId=356767" "$M/loras" name
  for (const m of sh.matchAll(/^\s*civ "([^"]+)"\s+"\$M\/loras"\s+([^\s"$]\S*)/gm)) out.push({ filename: m[2], url: `${CV}/${m[1]}` });
  // Heredoc „name id fid“ zwischen <<'LORAS' und LORAS
  const block = sh.match(/<<'LORAS'\n([\s\S]*?)\nLORAS/);
  for (const line of block?.[1].split("\n") ?? []) {
    const [name, id, fid] = line.trim().split(/\s+/);
    if (name && id && fid) out.push({ filename: name, url: `${CV}/${id}?fileId=${fid}` });
  }
  // dl "$HF/…/loras/x.safetensors" \ "$M/loras" name
  for (const m of sh.matchAll(/dl "\$HF(\/[^"]+)"\s*\\?\s*"\$M\/loras"\s+(\S+)/g)) out.push({ filename: m[2], url: `https://huggingface.co${m[1]}` });
  return out;
}

describe("LoRA-Links aus dem Pod-Setup", () => {
  it("findet die LoRAs in setup.sh", () => {
    expect(setupLoras().length).toBeGreaterThanOrEqual(15);
  });

  it("jede Setup-LoRA steht mit Link in der Liste", () => {
    const byName = new Map(BUILTIN_MODEL_LINKS.map((l) => [l.filename, l]));
    for (const l of setupLoras()) {
      const b = byName.get(l.filename);
      expect(b, l.filename).toBeDefined();
      expect(b!.type).toBe("lora");
      // Krea-Links stehen ohne „?type=Model“ drin – gleicher Download
      expect(b!.url.replace(/\?type=Model$/, ""), l.filename).toBe(l.url.replace(/\?type=Model$/, ""));
    }
  });
});

describe("Krea 2 auf neuen Pods", () => {
  it("lädt Lustify statt des Standard-Turbo-Modells und keine NSFW-LoRAs", () => {
    expect(sh).toMatch(/civ "3112728\?fileId=2997637"\s+"\$M\/diffusion_models"\s+lustify-v10-krea-turbo-fp8\.safetensors/);
    expect(sh).not.toMatch(/^\s*dl .*krea2_turbo_fp8_scaled/m);
    expect(sh).not.toMatch(/^\s*civ .*krea2_nsfw_v2/m);
    expect(sh).not.toMatch(/^\s*civ .*krea2_turbo_nsfw/m);
    // Text-Encoder und VAE von Krea 2 bleiben
    expect(sh).toMatch(/qwen3vl_4b_fp8_scaled\.safetensors/);
  });

  it("Lustify steht mit Link in der Merkliste (auf jedem Pod per Tipp nachladbar)", () => {
    const l = BUILTIN_MODEL_LINKS.find((x) => x.filename === "lustify-v10-krea-turbo-fp8.safetensors");
    expect(l).toMatchObject({ type: "unet", url: `${CV}/3112728?fileId=2997637` });
  });
});

describe("Altes Krea-Preset auf neuem Pod", () => {
  it("fehlt das gespeicherte UNet und Lustify ist da, wird Lustify genommen", async () => {
    const { kreaUnetFallback } = await import("@/lib/krea2");
    const avail = ["anima-base-v1.0.safetensors", "lustify-v10-krea-turbo-fp8.safetensors"];
    expect(kreaUnetFallback("krea2_turbo_fp8_scaled.safetensors", avail)).toBe("lustify-v10-krea-turbo-fp8.safetensors");
    // vorhanden → bleibt
    expect(kreaUnetFallback("anima-base-v1.0.safetensors", avail)).toBeNull();
    // Liste noch nicht geladen oder Lustify fehlt auch → nichts ändern
    expect(kreaUnetFallback("krea2_turbo_fp8_scaled.safetensors", [])).toBeNull();
    expect(kreaUnetFallback("krea2_turbo_fp8_scaled.safetensors", ["anima-base-v1.0.safetensors"])).toBeNull();
  });
});
