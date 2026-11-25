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
