import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(path.join(tmpdir(), "mirror-"));
beforeAll(() => {
  process.env.DATA_DIR = root;
  process.env.OUTPUT_DIR = path.join(root, "out");
  mkdirSync(root, { recursive: true });
  // Stand vor dem Fix: Vermerke nur mit Dateinamen
  writeFileSync(path.join(root, "outputs-index.json"), JSON.stringify({ files: {}, prompts: ["alt1", "alt2"], deleted: ["wai/bild_001_00001_.png"] }));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("Gelöscht-Vermerke", () => {
  it("alte Vermerke ohne Zeit werden verworfen, Verlauf wird neu geprüft", async () => {
    const { deletedMap } = await import("@/lib/server/mirror");
    expect(await deletedMap()).toEqual({});
    await new Promise((r) => setTimeout(r, 700));
    const saved = JSON.parse(readFileSync(path.join(root, "outputs-index.json"), "utf8"));
    expect(saved.deleted).toBeUndefined();
    expect(saved.prompts).toEqual([]);
  });

  it("neuer Pod, gleicher Dateiname: nur Ältere bleiben versteckt", async () => {
    const { forgetMirroredMany, deletedMap, isDeleted } = await import("@/lib/server/mirror");
    const f = { subfolder: "wai", filename: "bild_001_00001_.png" };
    const before = Date.now() - 60_000;
    await forgetMirroredMany([f]);
    const map = await deletedMap();
    expect(isDeleted(map, f, before)).toBe(true); // das gelöschte Bild
    expect(isDeleted(map, f, Date.now() + 1000)).toBe(false); // neues Bild mit gleichem Namen
    expect(isDeleted(map, { subfolder: "wai", filename: "anderes.png" }, before)).toBe(false);
  });
});
