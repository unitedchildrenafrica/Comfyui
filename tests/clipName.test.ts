import { describe, expect, it } from "vitest";
import { buildWorkflow as buildH3 } from "@/lib/builders/h3";
import { defaultH3Settings } from "@/lib/defaults";
import { nextClipName, parseH3Prompt, safeClipName, splitClipName } from "@/lib/h3prompt";

const BLOCKS = `subject_definitions:
S1: woman

summary:
A walk.

retention_analysis:
x

detailed_description:
y

overall_soundscape:
no dialogue, no speech, no voices

non_diegetic_music:
N/A`;

describe("Clip-Name aus der ersten Zeile", () => {
  it("erkennt „Clip 35“ und lässt den Prompt sauber", () => {
    const r = splitClipName(`Clip 35\n\n${BLOCKS}`);
    expect(r.name).toBe("Clip 35");
    expect(parseH3Prompt(r.text)?.summary).toBe("A walk.");
  });

  it("verträgt Markdown und Code-Zäune von Claude", () => {
    expect(splitClipName(`**Clip 44**\n${BLOCKS}`).name).toBe("Clip 44");
    expect(splitClipName(`# Clip #7\n${BLOCKS}`).name).toBe("Clip 7");
    const fenced = splitClipName("```\nClip 12\n" + BLOCKS + "\n```");
    expect(fenced.name).toBe("Clip 12");
    expect(parseH3Prompt(fenced.text)).not.toBeNull();
  });

  it("nimmt „Name: …“ und beliebige kurze Zeilen vor den Blöcken", () => {
    expect(splitClipName(`Name: Pool Szene\n${BLOCKS}`).name).toBe("Pool Szene");
    expect(splitClipName(`Clip 35 – Pool\n${BLOCKS}`).name).toBe("Clip 35 – Pool");
  });

  it("ohne Clip-Zeile bleibt alles wie vorher", () => {
    expect(splitClipName(BLOCKS)).toEqual({ name: "", text: BLOCKS });
    // Freitext-Prompt: normale erste Zeile ist kein Name
    expect(splitClipName("A woman walks along the beach.\nThe sun sets.").name).toBe("");
    // aber „Clip 3“ im Freitext schon
    expect(splitClipName("Clip 3\nA woman walks.")).toEqual({ name: "Clip 3", text: "A woman walks." });
  });

  it("macht daraus einen sicheren Dateinamen und zählt hoch", () => {
    expect(safeClipName("Clip 35")).toBe("Clip_35");
    expect(safeClipName("../a/b:c%d")).toBe("a_b_c_d");
    expect(nextClipName("Clip 35")).toBe("Clip 36");
    expect(nextClipName("Clip_09")).toBe("Clip_10");
    expect(nextClipName("Pool")).toBeNull();
  });

  it("setzt den Dateinamen im Video-Node", () => {
    const named = buildH3({ settings: { ...defaultH3Settings(), clipName: "Clip 35" }, seed: 1 });
    expect(named["2568"].inputs.filename_prefix).toBe("video/%date:yyyy-MM-dd%/Clip_35");
    const plain = buildH3({ settings: defaultH3Settings(), seed: 1 });
    expect(plain["2568"].inputs.filename_prefix).toBe("video/%date:yyyy-MM-dd%/%date:hhmmss%");
  });
});
