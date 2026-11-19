import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const img = (filename: string) => ({ kind: "image" as const, filename });

describe("Tab-Gruppen", () => {
  beforeEach(() => {
    process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "groups-"));
  });

  it("speichert, überschreibt bei gleichem Namen und löscht", async () => {
    const { deleteGroup, listGroups, saveGroup } = await import("@/lib/server/refTabGroups");
    const a = await saveGroup("Strand  Video ", [[img("a.png")], []]);
    expect(a.name).toBe("Strand Video");
    await saveGroup("Büro", [[img("b.png")]]);
    expect((await listGroups()).map((g) => g.name)).toEqual(["Büro", "Strand Video"]);
    const again = await saveGroup("strand video", [[img("c.png")]]);
    expect(again.id).toBe(a.id);
    const list = await listGroups();
    expect(list.map((g) => g.name)).toEqual(["strand video", "Büro"]);
    expect(list[0].tabs).toEqual([[img("c.png")]]);
    await deleteGroup(a.id);
    expect((await listGroups()).map((g) => g.name)).toEqual(["Büro"]);
  });

  it("lehnt leere Namen und kaputte Tabs ab", async () => {
    const { saveGroup } = await import("@/lib/server/refTabGroups");
    await expect(saveGroup("  ", [[]])).rejects.toThrow("Namen");
    await expect(saveGroup("X", [[{ kind: "exe", filename: "x" }]])).rejects.toThrow("Ungültige");
  });

  it("zwei gleichzeitige Speichervorgänge gehen beide durch", async () => {
    const { listGroups, saveGroup } = await import("@/lib/server/refTabGroups");
    await Promise.all([saveGroup("A", [[]]), saveGroup("B", [[]])]);
    expect((await listGroups()).map((g) => g.name).sort()).toEqual(["A", "B"]);
  });
});
