import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanFileName, cleanFolderName, photoKind } from "@/lib/photos";

const root = mkdtempSync(path.join(tmpdir(), "fotos-"));
beforeAll(() => {
  process.env.DATA_DIR = root;
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const stream = (b: Buffer) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(b));
      c.close();
    },
  });

describe("Namen", () => {
  it("Ordnernamen", () => {
    expect(cleanFolderName("  Urlaub   2026 ")).toBe("Urlaub 2026");
    expect(cleanFolderName("Größe (alt)")).toBe("Größe (alt)");
    expect(cleanFolderName("../etc")).toBeNull();
    expect(cleanFolderName("a/b")).toBeNull();
    expect(cleanFolderName(".versteckt")).toBeNull();
    expect(cleanFolderName("")).toBeNull();
  });
  it("Dateinamen", () => {
    expect(cleanFileName("IMG_0001.HEIC")).toBe("IMG_0001.heic");
    expect(cleanFileName("../../böse:datei?.jpg")).toBe("böse_datei_.jpg");
    expect(cleanFileName("skript.sh")).toBeNull();
    expect(cleanFileName(".jpg")).toBeNull();
    expect(photoKind("clip.MOV")).toBe("video");
  });
});

describe("Ordner und Upload", () => {
  it("Upload in Stücken, mit Wiederholung und freiem Namen", async () => {
    const p = await import("@/lib/server/photos");
    expect(await p.createFolder("Urlaub")).toBe("Urlaub");
    await expect(p.createFolder("urlaub")).rejects.toThrow("gibt es schon");

    const data = Buffer.from("A".repeat(10) + "B".repeat(10) + "C".repeat(5));
    const up = (offset: number, end: number, id = "upload-0001") =>
      p.writeChunk({ folder: "Urlaub", name: "bild.jpg", uploadId: id, offset, total: data.length, body: stream(data.subarray(offset, end)) });

    expect(await up(0, 10)).toEqual({ done: false, received: 10 });
    // Wiederholung desselben Stücks (Antwort ging verloren): nichts doppelt, weiter ab 10
    expect(await up(0, 10)).toEqual({ done: false, received: 10 });
    await expect(up(20, 25)).rejects.toThrow("Abschnitt fehlt");
    expect(await up(10, 20)).toEqual({ done: false, received: 20 });
    const last = await up(20, 25);
    expect(last).toEqual({ done: true, received: 25, name: "bild.jpg" });
    expect(readFileSync(path.join(root, "fotos", "Urlaub", "bild.jpg"), "utf8")).toBe(data.toString());

    // gleicher Name nochmal → „bild (2).jpg“, nichts überschrieben
    const again = await p.writeChunk({ folder: "Urlaub", name: "bild.jpg", uploadId: "upload-0002", offset: 0, total: 3, body: stream(Buffer.from("xyz")) });
    expect(again.name).toBe("bild (2).jpg");

    const files = await p.listFiles("Urlaub");
    expect(files.map((f) => f.name).sort()).toEqual(["bild (2).jpg", "bild.jpg"]);
    const folders = await p.listFolders();
    expect(folders).toEqual([expect.objectContaining({ name: "Urlaub", count: 2, cover: expect.any(String) })]);
  });

  it("lehnt falsche Ordner, Pfade und Übergrößen ab", async () => {
    const p = await import("@/lib/server/photos");
    await expect(p.writeChunk({ folder: "../x", name: "a.jpg", uploadId: "upload-0003", offset: 0, total: 1, body: stream(Buffer.from("a")) })).rejects.toThrow();
    await expect(p.writeChunk({ folder: "Gibtsnicht", name: "a.jpg", uploadId: "upload-0003", offset: 0, total: 1, body: stream(Buffer.from("a")) })).rejects.toThrow("gibt es nicht");
    await expect(p.writeChunk({ folder: "Urlaub", name: "a.exe", uploadId: "upload-0003", offset: 0, total: 1, body: stream(Buffer.from("a")) })).rejects.toThrow("kein Bild");
    await expect(p.writeChunk({ folder: "Urlaub", name: "a.jpg", uploadId: "upload-0004", offset: 0, total: 2, body: stream(Buffer.from("abc")) })).rejects.toThrow("Mehr Daten");
    expect(p.photoPath("Urlaub", "../../model-links.json")).toBeNull();
    expect(p.photoPath("..", "x.jpg")).toBeNull();
  });

  it("umbenennen, Dateien löschen, Ordner löschen", async () => {
    const p = await import("@/lib/server/photos");
    expect(await p.renameFolder("Urlaub", "Urlaub 2026")).toBe("Urlaub 2026");
    expect(await p.deleteFiles("Urlaub 2026", ["bild.jpg", "../../x.jpg"])).toBe(1);
    expect((await p.listFiles("Urlaub 2026")).map((f) => f.name)).toEqual(["bild (2).jpg"]);
    await p.deleteFolder("Urlaub 2026");
    expect(await p.listFolders()).toEqual([]);
  });
});
