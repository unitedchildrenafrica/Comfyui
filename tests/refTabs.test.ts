import { describe, expect, it } from "vitest";
import { buildWorkflow as buildH3 } from "@/lib/builders/h3";
import { defaultH3Settings } from "@/lib/defaults";
import { parseVideoBatch, settingsForItem } from "@/lib/h3batch";
import { parseRefTabLine } from "@/lib/h3prompt";
import { refLimitError, tagWarnings } from "@/lib/h3refs";
import type { H3Ref } from "@/lib/types";

const prompt = (summary: string, extra = "") => `subject_definitions:
S1: woman ${extra}

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

const img = (n: string): H3Ref => ({ kind: "image", filename: n });
const tabs: H3Ref[][] = [[img("a.png")], [img("b.png"), img("c.png")], [img("d.png"), { kind: "audio", filename: "v.mp3", duration: 5 }], [], []];
const REF = { mode: "REF2VA", noDialogue: true, tabs, defaultTab: 1 };

describe("Ref-Tab-Zeile", () => {
  it("erkennt die üblichen Schreibweisen", () => {
    for (const l of ["Ref-Tab 3", "reftab 3", "Ref 3", "REF TAB: 3", "**Ref-Tab 3**", "# Ref-Tab #3", "Ref-Tab3"]) expect(parseRefTabLine(l), l).toBe(3);
    for (const l of ["Clip 3", "References: 3 people", "Ref", "Ref-Tab 0", "Reference image 3"]) expect(parseRefTabLine(l), l).toBeNull();
  });
});

describe("Video-Batch mit Ref-Tabs", () => {
  it("nimmt den Tab aus der ersten Zeile und den Namen aus der zweiten", () => {
    const r = parseVideoBatch(`Ref-Tab 2\nClip 35\n${prompt("Beach")}\n---\nClip 36\n${prompt("Pool")}`, REF);
    expect(r.errors).toEqual([]);
    expect(r.items.map((i) => [i.name, i.refTab, i.refs?.map((x) => x.filename)])).toEqual([
      ["Clip 35", 2, ["b.png", "c.png"]],
      ["Clip 36", 1, ["a.png"]],
    ]);
  });

  it("hängt die Ref-Zeile ohne --- an den folgenden Clip", () => {
    const r = parseVideoBatch(`Ref-Tab 1\nClip 34\n${prompt("A")}\n\nRef-Tab 3\nClip 35\n${prompt("B")}\nClip 36\n${prompt("C")}`, REF);
    expect(r.errors).toEqual([]);
    expect(r.items.map((i) => [i.name, i.refTab])).toEqual([
      ["Clip 34", 1],
      ["Clip 35", 3],
      ["Clip 36", 1],
    ]);
  });

  it("erkennt auch die umgekehrte Reihenfolge", () => {
    const r = parseVideoBatch(`Clip 35\nRef-Tab 2\n${prompt("Beach")}`, REF);
    expect(r.items[0]).toMatchObject({ name: "Clip 35", refTab: 2 });
    expect(r.items[0].blocks?.summary).toBe("Beach");
  });

  it("meldet einen Tab, den es nicht gibt, als Fehler", () => {
    const r = parseVideoBatch(`Ref-Tab 7\nClip 1\n${prompt("A")}`, REF);
    expect(r.items).toHaveLength(0);
    expect(r.errors[0].message).toContain("Ref-Tab 7");
  });

  it("warnt bei leerem Tab und bei Tags, die der Tab nicht hat", () => {
    const r = parseVideoBatch(`Ref-Tab 4\nClip 1\n${prompt("A")}\n---\nRef-Tab 2\nClip 2\n${prompt("B", "<Picture 3> <Audio 1>")}`, REF);
    expect(r.errors).toEqual([]);
    expect(r.items[0].warnings.join(" ")).toContain("leer");
    expect(r.items[1].warnings.join(" ")).toContain("<Picture 3>");
    expect(r.items[1].warnings.join(" ")).toContain("<Audio 1>");
  });

  it("speichert pro Clip die echten Refs, aber nicht alle Tabs", () => {
    const s = { ...defaultH3Settings(), promptInput: "batch" as const, refs: tabs[0], refTab: 1, refTabs: tabs, batchText: `Ref-Tab 3\nClip 9\n${prompt("A")}` };
    const { items } = parseVideoBatch(s.batchText, REF);
    const one = settingsForItem(s, items[0]);
    expect(one.refs.map((r) => r.filename)).toEqual(["d.png", "v.mp3"]);
    expect(one.refTab).toBe(3);
    expect(one.refTabs).toBeUndefined();
    expect(one.batchText).toBeUndefined();
  });

  it("ohne Tabs (alte Formulare) verhält sich alles wie bisher", () => {
    const r = parseVideoBatch(`Clip 1\n${prompt("A")}`, { mode: "REF2VA", noDialogue: true });
    expect(r.items[0]).toMatchObject({ name: "Clip 1", refTab: null, refs: null });
  });
});

describe("Prüfungen", () => {
  it("tagWarnings zählt Bilder, Videos und Audios getrennt", () => {
    const refs: H3Ref[] = [img("a"), { kind: "video", filename: "v.mp4", mediaMode: "audio" }, { kind: "audio", filename: "x.mp3" }];
    expect(tagWarnings("<Picture 1> <Audio 2>", refs)).toEqual([]);
    expect(tagWarnings("<Picture 2> <Video 1> <Audio 3>", refs)).toHaveLength(3);
  });

  it("refLimitError prüft die H3-Grenzen", () => {
    expect(refLimitError(Array.from({ length: 9 }, (_, i) => img(`${i}`)))).toBeNull();
    expect(refLimitError(Array.from({ length: 10 }, (_, i) => img(`${i}`)))).toContain("9");
    expect(refLimitError(Array.from({ length: 4 }, (_, i) => ({ kind: "audio" as const, filename: `${i}` })))).toContain("3");
  });
});

describe("Ref-Tabs speichern", () => {
  it("cleanTabs übernimmt nur bekannte Felder und lehnt Unsinn ab", async () => {
    const { cleanTabs } = await import("@/lib/server/refTabs");
    expect(cleanTabs([[{ kind: "video", filename: "v.mp4", mediaMode: "audio", trimStart: 1, evil: "x" }], []])).toEqual([
      [{ kind: "video", filename: "v.mp4", mediaMode: "audio", trimStart: 1 }],
      [],
    ]);
    expect(cleanTabs([[{ kind: "exe", filename: "x" }]])).toBeNull();
    expect(cleanTabs([])).toBeNull();
    expect(cleanTabs(Array.from({ length: 11 }, () => []))).toBeNull();
    expect(cleanTabs("nope")).toBeNull();
  });
});

describe("Upload ohne Pod", () => {
  it("offlineName ist dateisicher, eindeutig und behält die Endung", async () => {
    const { offlineName, refCopyPath } = await import("@/lib/server/refs");
    const a = offlineName("IMG 3441 (1).PNG");
    expect(a).toMatch(/^IMG_3441_1_[a-z0-9]+\.png$/);
    expect(offlineName("x.png")).not.toBe(offlineName("x.png"));
    expect(offlineName("../../etc/passwd")).not.toContain("/");
    expect(refCopyPath(offlineName("../../etc/passwd"))).not.toBeNull();
    expect(offlineName(".mp3")).toMatch(/^[\w-]+_[a-z0-9]+$/);
    expect(offlineName("###.png")).toMatch(/^ref_[a-z0-9]+\.png$/);
  });
});

describe("Dauer pro Clip", () => {
  it("erkennt die üblichen Schreibweisen", async () => {
    const { parseDurationLine } = await import("@/lib/h3prompt");
    for (const l of ["Dauer 8", "Dauer: 8 s", "dauer 8s", "Länge 8", "Duration: 8", "8s", "8 s", "8 Sekunden", "**Dauer 8**", "8 sek"]) expect(parseDurationLine(l), l).toBe(8);
    for (const l of ["Clip 8", "8", "Ref-Tab 8", "summary: 8s", "Dauer", "the woman waits 8 seconds"]) expect(parseDurationLine(l), l).toBeNull();
  });

  it("nimmt die Dauer pro Clip, sonst die aus dem Formular – Reihenfolge der Kopfzeilen egal", () => {
    const text = `Ref-Tab 2\nClip 1\nDauer 6\n${prompt("A")}\n---\nDauer 12\nRef-Tab 3\nClip 2\n${prompt("B")}\n---\nClip 3\n${prompt("C")}`;
    const r = parseVideoBatch(text, REF);
    expect(r.errors).toEqual([]);
    expect(r.items.map((i) => [i.name, i.refTab, i.duration])).toEqual([
      ["Clip 1", 2, 6],
      ["Clip 2", 3, 12],
      ["Clip 3", 1, null],
    ]);
    expect(r.items[0].blocks?.summary).toBe("A");
  });

  it("hängt Kopfzeilen ohne --- an den folgenden Clip", () => {
    const r = parseVideoBatch(`Clip 1\n${prompt("A")}\n\nRef-Tab 2\nDauer 5\nClip 2\n${prompt("B")}`, REF);
    expect(r.items.map((i) => [i.name, i.refTab, i.duration])).toEqual([
      ["Clip 1", 1, null],
      ["Clip 2", 2, 5],
    ]);
  });

  it("meldet eine Dauer außerhalb von 2–15 s als Fehler", () => {
    const r = parseVideoBatch(`Clip 1\nDauer 20\n${prompt("A")}`, REF);
    expect(r.items).toHaveLength(0);
    expect(r.errors[0].message).toContain("20");
  });

  it("speichert die Dauer im Job des Clips", () => {
    const s = { ...defaultH3Settings(), duration: 10, promptInput: "batch" as const, batchText: `Clip 1\nDauer 4\n${prompt("A")}\n---\nClip 2\n${prompt("B")}` };
    const { items } = parseVideoBatch(s.batchText, REF);
    expect(settingsForItem(s, items[0]).duration).toBe(4);
    expect(settingsForItem(s, items[1]).duration).toBe(10);
    // im Workflow landet die Dauer im Director (Widget und builder_state)
    const wf = buildH3({ settings: settingsForItem(s, items[0]), seed: 1 });
    expect(wf["2730"].inputs.duration).toBe(4);
    expect(JSON.parse(String(wf["2730"].inputs.builder_state)).duration).toBe(4);
  });
});
