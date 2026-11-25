import { describe, expect, it } from "vitest";
import { sortByDownload } from "@/lib/loraOrder";

describe("sortByDownload", () => {
  it("zuletzt geladene zuerst, Rest alphabetisch, Unterordner egal", () => {
    const names = ["zeta.safetensors", "pony/alt.safetensors", "Beta.safetensors", "neu.safetensors", "alpha.safetensors"];
    const links = [
      { filename: "alt.safetensors", savedAt: 1000, type: "lora" },
      { filename: "neu.safetensors", savedAt: 5000, type: "lora" },
      { filename: "zeta.safetensors", savedAt: 0, type: "lora" }, // fest eingebaut, kein Datum
      { filename: "alpha.safetensors", savedAt: 9000, type: "checkpoint" }, // kein LoRA-Link
    ];
    expect(sortByDownload(names, links)).toEqual(["neu.safetensors", "pony/alt.safetensors", "alpha.safetensors", "Beta.safetensors", "zeta.safetensors"]);
  });
});
