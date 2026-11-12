import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(path.join(tmpdir(), "favs-"));
const out = path.join(root, "output");
beforeAll(() => {
  process.env.DATA_DIR = path.join(root, "data");
  process.env.OUTPUT_DIR = out;
  for (const [sub, name] of [
    ["wai", "a.png"],
    ["wai", "b.png"],
    ["video/2026-11-12", "Clip_1_00001.mp4"],
  ]) {
    mkdirSync(path.join(out, sub), { recursive: true });
    writeFileSync(path.join(out, sub, name), "x");
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const fav = (subfolder: string, filename: string, kind: "image" | "video" = "image") => ({
  filename,
  subfolder,
  type: "output",
  kind,
  promptId: "p",
  label: filename,
  timestamp: 1,
});

describe("Favoriten überleben das Löschen", () => {
  it("ganze Galerie löschen → Favoriten wandern in den Favoriten-Speicher", async () => {
    const { saveFavorites, getFavorites } = await import("@/lib/server/store");
    const { deleteFolder } = await import("@/lib/server/outputs");
    const { favoriteFileExists } = await import("@/lib/server/favStore");
    await saveFavorites([fav("wai", "a.png"), fav("video/2026-11-12", "Clip_1_00001.mp4", "video")]);

    const r = await deleteFolder("");
    expect(r.deleted).toBe(3);
    expect(r.keptFavorites).toBe(2);
    // aus der Galerie (Ausgabeordner) verschwunden …
    expect(existsSync(path.join(out, "wai", "a.png"))).toBe(false);
    expect(existsSync(path.join(out, "wai", "b.png"))).toBe(false);
    // … aber als Favorit gesichert
    expect(await favoriteFileExists("wai", "a.png")).toBe(true);
    expect(await favoriteFileExists("video/2026-11-12", "Clip_1_00001.mp4")).toBe(true);
    expect((await getFavorites()).map((f) => f.type)).toEqual(["favorite", "favorite"]);
  });

  it("alter Browser-Stand überschreibt den Speicher-Status nicht", async () => {
    const { saveFavorites } = await import("@/lib/server/store");
    const saved = await saveFavorites([fav("wai", "a.png"), fav("video/2026-11-12", "Clip_1_00001.mp4", "video")]);
    expect(saved.map((f) => f.type)).toEqual(["favorite", "favorite"]);
  });

  it("erst das Entfernen aus den Favoriten löscht endgültig", async () => {
    const { PUT } = await import("@/app/api/favorites/route");
    const { favoriteFileExists } = await import("@/lib/server/favStore");
    const req = new Request("http://x/api/favorites", { method: "PUT", body: JSON.stringify({ items: [fav("video/2026-11-12", "Clip_1_00001.mp4", "video")] }) });
    const res = await PUT(req as never);
    expect(res.status).toBe(200);
    expect(await favoriteFileExists("wai", "a.png")).toBe(false);
    expect(await favoriteFileExists("video/2026-11-12", "Clip_1_00001.mp4")).toBe(true);
  });
});
