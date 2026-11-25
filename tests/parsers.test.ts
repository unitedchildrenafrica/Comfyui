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

  it("Krea 2: negative:-Zeilen werden ignoriert und gezählt", () => {
    const r = parseBatch("positive: a\nnegative: n1\n---\npositive: b\n---\npositive: c\nnegative: n3\nname: x", "DEF", { ignoreNegative: true });
    expect(r.errors).toEqual([]);
    expect(r.ignoredNegatives).toBe(2);
    expect(r.items).toEqual([
      { positive: "a", negative: "", name: "bild_001" },
      { positive: "b", negative: "", name: "bild_002" },
      { positive: "c", negative: "", name: "x" },
    ]);
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

import { refWarnings, usedSeconds } from "@/lib/h3refs";

describe("Audio-Referenzen", () => {
  const img = { kind: "image" as const, filename: "a.png" };
  it("usedSeconds mit Start/Ende", () => {
    expect(usedSeconds({ duration: 30 })).toBe(30);
    expect(usedSeconds({ duration: 30, trimStart: 5, trimEnd: 12 })).toBe(7);
    expect(usedSeconds({ trimEnd: 8 })).toBe(8);
    expect(usedSeconds({})).toBeNull();
  });
  it("Warnungen", () => {
    expect(refWarnings([img, { kind: "audio", filename: "x.mp3", duration: 10 }])).toEqual([]);
    expect(refWarnings([img, { kind: "audio", filename: "x.mp3", duration: 30 }])[0]).toContain("höchstens 15");
    expect(refWarnings([img, { kind: "audio", filename: "x.mp3", duration: 1 }])[0]).toContain("mindestens 2");
    expect(refWarnings([{ kind: "audio", filename: "x.mp3", duration: 5 }])[0]).toContain("Referenzbild");
    expect(refWarnings([img, { kind: "audio", filename: "x", duration: 9 }, { kind: "audio", filename: "y", duration: 9 }]).at(-1)).toContain("zusammen");
    expect(refWarnings([img, { kind: "audio", filename: "x", duration: 20, trimStart: 5, trimEnd: 3 }])[0]).toContain("Ende");
  });
});

describe("Video-Referenzen (REF2VA)", () => {
  it("Tags wie im Director: Videos zählen eigen, Nur-Ton-Videos vor Audio-Dateien", async () => {
    const { refTag } = await import("@/lib/h3refs");
    const img = { kind: "image" as const, filename: "a.png" };
    const v1 = { kind: "video" as const, filename: "tanz.mp4", mediaMode: "video" as const, duration: 5 };
    const v2 = { kind: "video" as const, filename: "stimme.mp4", mediaMode: "audio" as const, duration: 4 };
    const v3 = { kind: "video" as const, filename: "szene.mov", mediaMode: "video_audio" as const, duration: 4 };
    const au = { kind: "audio" as const, filename: "x.mp3", duration: 3 };
    const refs = [img, au, v1, v2, v3];
    expect([img, v1, v2, v3, au].map((r) => refTag(refs, r))).toEqual(["<Picture 1>", "<Video 1>", "<Audio 1>", "<Video 2>", "<Audio 2>"]);
  });

  it("prüft 15 s für Videos und Ton sowie maximal 3 Tonspuren", async () => {
    const { refWarnings } = await import("@/lib/h3refs");
    const v = (filename: string, duration: number, mediaMode: "video" | "audio" | "video_audio" = "video") => ({ kind: "video" as const, filename, duration, mediaMode });
    expect(refWarnings([v("a", 8), v("b", 6)])).toEqual([]);
    expect(refWarnings([v("a", 9), v("b", 9)]).at(-1)).toContain("Alle Videos zusammen");
    expect(refWarnings([v("a", 3, "audio")])[0]).toContain("Referenzbild oder ein Video");
    const many = [v("a", 3, "video_audio"), v("b", 3, "video_audio"), { kind: "audio" as const, filename: "c", duration: 3 }, { kind: "audio" as const, filename: "d", duration: 3 }];
    expect(refWarnings(many)[0]).toContain("Tonspuren");
  });

  it("landen als Timeline-Einträge mit media_mode und Kürzung – nur in REF2VA", async () => {
    const { timelineItems } = await import("@/lib/builders/h3");
    const { defaultH3Settings } = await import("@/lib/defaults");
    const refs = [
      { kind: "image" as const, filename: "a.png" },
      { kind: "video" as const, filename: "tanz.mp4", mediaMode: "video_audio" as const, trimStart: 1, trimEnd: 6 },
    ];
    const items = timelineItems({ ...defaultH3Settings(), mode: "REF2VA", refs });
    expect(items[1]).toMatchObject({ type: "video", value: "tanz.mp4", slot: 0, media_mode: "video_audio", trim_start: 1, trim_end: 6 });
    expect(timelineItems({ ...defaultH3Settings(), mode: "I2VA", refs }).map((i) => i.type)).toEqual(["image"]);
  });
});
