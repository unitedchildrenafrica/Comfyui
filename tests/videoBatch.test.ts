import { describe, expect, it } from "vitest";
import { buildWorkflow as buildH3 } from "@/lib/builders/h3";
import { defaultH3Settings } from "@/lib/defaults";
import { parseVideoBatch, settingsForItem, splitVideoBatch } from "@/lib/h3batch";

const prompt = (summary: string) => `subject_definitions:
S1: woman

summary:
${summary}

retention_analysis:
x

detailed_description:
y

overall_soundscape:
waves, no dialogue, no speech, no voices

non_diegetic_music:
N/A`;

const REF = { mode: "REF2VA", noDialogue: true };

describe("Video-Batch", () => {
  it("trennt an --- und nimmt die Clip-Zeile als Namen", () => {
    const text = `Hier sind deine Prompts:\n\n---\n\nClip 35\n${prompt("Beach")}\n\n---\n\n**Clip 36**\n${prompt("Pool")}\n---\nViel Spaß!`;
    const r = parseVideoBatch(text, REF);
    expect(r.errors).toEqual([]);
    expect(r.items.map((i) => [i.name, i.blocks?.summary])).toEqual([
      ["Clip 35", "Beach"],
      ["Clip 36", "Pool"],
    ]);
    expect(r.skipped).toEqual(["Hier sind deine Prompts:", "Viel Spaß!"]);
    expect(r.items[0].warnings).toEqual([]);
  });

  it("trennt ohne --- vor jeder „Clip N“-Zeile, auch in Code-Blöcken", () => {
    const text = "```\nClip 1\n" + prompt("A") + "\n```\n\n```\nClip 2\n" + prompt("B") + "\n```";
    const r = parseVideoBatch(text, REF);
    expect(r.items.map((i) => i.name)).toEqual(["Clip 1", "Clip 2"]);
  });

  it("meldet kaputte Abschnitte statt sie zu überspringen", () => {
    const r = parseVideoBatch(`Clip 1\n${prompt("A")}\n---\nClip 2\nsummary:\nx\nsummary:\ny`, REF);
    expect(r.items).toHaveLength(1);
    expect(r.errors[0].block).toBe(2);
    expect(r.errors[0].message).toContain("Clip 2");
  });

  it("nimmt in anderen Modi Freitext", () => {
    const r = parseVideoBatch("Clip 1\nA woman walks.\n---\nClip 2\nA man runs.", { mode: "T2VA", noDialogue: false });
    expect(r.items.map((i) => [i.name, i.text])).toEqual([
      ["Clip 1", "A woman walks."],
      ["Clip 2", "A man runs."],
    ]);
  });

  it("baut pro Clip einen eigenen Workflow mit Namen", () => {
    const s = { ...defaultH3Settings(), promptInput: "batch" as const, batchText: `Clip 7\n${prompt("Beach")}\n---\n${prompt("Pool")}` };
    const { items } = parseVideoBatch(s.batchText, REF);
    expect(splitVideoBatch(s.batchText)).toHaveLength(2);
    const one = settingsForItem(s, items[0]);
    expect(one.batchText).toBeUndefined();
    expect(one.promptInput).toBe("blocks");
    const wf = buildH3({ settings: one, seed: 1 });
    expect(wf["2568"].inputs.filename_prefix).toBe("video/%date:yyyy-MM-dd%/Clip_7");
    expect(String(wf["2730"].inputs.prompt)).toContain("Beach");
    const two = buildH3({ settings: settingsForItem(s, items[1]), seed: 1 });
    expect(two["2568"].inputs.filename_prefix).toBe("video/%date:yyyy-MM-dd%/%date:hhmmss%");
  });
});
