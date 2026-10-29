import { describe, expect, it } from "vitest";
import { parseBatch } from "@/lib/batch";
import { buildH3Prompt, checkH3Prompt, emptyBlocks, parseH3Prompt } from "@/lib/h3prompt";

describe("parseBatch", () => {
  it("parst Blöcke, Standard-Negativ und Auto-Namen", () => {
    const { items, errors } = parseBatch(
      "positive: a\nnegative: n1\nname: x1\n---\npositive: b\nweiter\n---\n\n---\npositive: c",
      "DEF",
    );
    expect(errors).toEqual([]);
    expect(items).toEqual([
      { positive: "a", negative: "n1", name: "x1" },
      { positive: "b\nweiter", negative: "DEF", name: "bild_002" },
      { positive: "c", negative: "DEF", name: "bild_003" },
    ]);
  });

  it("meldet fehlerhafte Blöcke", () => {
    const { items, errors } = parseBatch("negative: x\n---\npositive: a\nname: ../evil\n---\nfoo\npositive: b\n---\npositive: c\nname: d\n---\npositive: e\nname: d", "");
    expect(items.map((i) => i.name)).toEqual(["d"]);
    expect(errors.map((e) => e.block)).toEqual([1, 2, 3, 5]);
  });

  it("schafft 250 Blöcke", () => {
    const text = Array.from({ length: 250 }, (_, i) => `positive: p${i}`).join("\n---\n");
    expect(parseBatch(text, "").items).toHaveLength(250);
  });
});

describe("H3 prompt", () => {
  it("bauen und wieder zerlegen", () => {
    const b = { ...emptyBlocks(), summary: "S", overall_soundscape: "rain" };
    const text = buildH3Prompt(b);
    expect(text.startsWith("subject_definitions:\n\n\nsummary:\nS")).toBe(true);
    expect(parseH3Prompt(text)).toEqual(b);
  });

  it("Aliase und Text davor", () => {
    expect(parseH3Prompt("summary: x\nsoundscape: y")?.overall_soundscape).toBe("y");
    expect(parseH3Prompt("Hallo\nsummary: x")).toBeNull();
    expect(parseH3Prompt("nur text")).toBeNull();
  });

  it("Warnungen", () => {
    expect(checkH3Prompt("(S1) <d>[English] hi</d>", "rain", true)).toHaveLength(2);
    expect(checkH3Prompt("x", "rain, no dialogue, no speech, no voices", true)).toEqual([]);
    expect(checkH3Prompt("(S1) <d>[English] Hello there</d>", "", false)).toEqual([]);
    expect(checkH3Prompt("(S1) says <d>hello", "", false).length).toBeGreaterThan(0);
  });
});

import { audioRefWarnings, usedSeconds } from "@/lib/h3refs";

describe("Audio-Referenzen", () => {
  const img = { kind: "image" as const, filename: "a.png" };
  it("usedSeconds mit Start/Ende", () => {
    expect(usedSeconds({ duration: 30 })).toBe(30);
    expect(usedSeconds({ duration: 30, trimStart: 5, trimEnd: 12 })).toBe(7);
    expect(usedSeconds({ trimEnd: 8 })).toBe(8);
    expect(usedSeconds({})).toBeNull();
  });
  it("Warnungen", () => {
    expect(audioRefWarnings([img, { kind: "audio", filename: "x.mp3", duration: 10 }])).toEqual([]);
    expect(audioRefWarnings([img, { kind: "audio", filename: "x.mp3", duration: 30 }])[0]).toContain("höchstens 15");
    expect(audioRefWarnings([img, { kind: "audio", filename: "x.mp3", duration: 1 }])[0]).toContain("mindestens 2");
    expect(audioRefWarnings([{ kind: "audio", filename: "x.mp3", duration: 5 }])[0]).toContain("Referenzbild");
    expect(audioRefWarnings([img, { kind: "audio", filename: "x", duration: 9 }, { kind: "audio", filename: "y", duration: 9 }]).at(-1)).toContain("zusammen");
    expect(audioRefWarnings([img, { kind: "audio", filename: "x", duration: 20, trimStart: 5, trimEnd: 3 }])[0]).toContain("Ende");
  });
});
