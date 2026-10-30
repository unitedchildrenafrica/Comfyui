import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { daysUntil, findAvailable, groupToSend, matches, monthKey, type Order, stripTokens } from "@/lib/notes";

const dir = mkdtempSync(path.join(tmpdir(), "notes-"));
beforeAll(() => {
  process.env.DATA_DIR = dir;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const order = (p: Partial<Order>): Order => ({
  id: Math.random().toString(36).slice(2),
  createdAt: 1,
  updatedAt: 1,
  person: "",
  character: "",
  kind: "image",
  status: "open",
  deadline: "",
  paid: false,
  note: "",
  ...p,
});

describe("Notiz-Helfer", () => {
  it("sucht über mehrere Wörter, Groß/klein egal", () => {
    const o = order({ person: "Max", character: "Ahri Halloween" });
    expect(matches("orders", o, "max ahri")).toBe(true);
    expect(matches("orders", o, "max jinx")).toBe(false);
    expect(matches("orders", o, "  ")).toBe(true);
  });

  it("gruppiert „zu schicken“ nach Person", () => {
    const groups = groupToSend([
      order({ person: "max", status: "tosend", character: "A" }),
      order({ person: "Max ", status: "tosend", character: "B" }),
      order({ person: "Anna", status: "tosend", character: "C" }),
      order({ person: "Anna", status: "sent", character: "D" }),
    ]);
    expect(groups.map((g) => [g.person, g.orders.length])).toEqual([
      ["Anna", 1],
      ["max", 2],
    ]);
  });

  it("findet LoRAs auch in Unterordnern", () => {
    expect(findAvailable("ahri.safetensors", ["pony/Ahri.safetensors", "x.safetensors"])).toBe("pony/Ahri.safetensors");
    expect(findAvailable("fehlt.safetensors", ["x.safetensors"])).toBeNull();
  });

  it("entfernt Tokens aus Links", () => {
    expect(stripTokens("https://civitai.red/api/download/models/1?fileId=2&token=geheim")).toBe("https://civitai.red/api/download/models/1?fileId=2");
  });

  it("rechnet Tage und Monate", () => {
    const now = new Date(2026, 9, 30, 15);
    expect(daysUntil("2026-10-30", now)).toBe(0);
    expect(daysUntil("2026-11-02", now)).toBe(3);
    expect(daysUntil("2026-10-28", now)).toBe(-2);
    expect(monthKey(now)).toBe("2026-10");
  });
});

describe("Notiz-Speicher", () => {
  it("legt an, erkennt Konflikte und löscht", async () => {
    const { listNotes, putNote, deleteNote, ConflictError } = await import("@/lib/server/notes");
    const a = await putNote("orders", { id: "a1", person: "Max", character: "Ahri", status: "quatsch" });
    expect(a.status).toBe("open");
    expect(a.updatedAt).toBeGreaterThan(0);

    const b = await putNote("orders", { ...a, status: "tosend" }, { baseUpdatedAt: a.updatedAt });
    expect(b.updatedAt).toBeGreaterThan(a.updatedAt);
    // Änderung auf altem Stand → Konflikt statt Überschreiben
    await expect(putNote("orders", { ...a, note: "alt" }, { baseUpdatedAt: a.updatedAt })).rejects.toBeInstanceOf(ConflictError);
    // erzwingen geht
    await putNote("orders", { ...a, note: "erzwungen" }, { baseUpdatedAt: a.updatedAt, force: true });
    expect((await listNotes("orders"))[0].note).toBe("erzwungen");

    // gleichzeitige Änderungen gehen nicht verloren
    await Promise.all(Array.from({ length: 20 }, (_, i) => putNote("ideas", { id: `i${i}`, title: `Idee ${i}` })));
    expect(await listNotes("ideas")).toHaveLength(20);

    await deleteNote("orders", "a1");
    expect(await listNotes("orders")).toHaveLength(0);
  });

  it("lehnt ungültige IDs ab und speichert keine Tokens in LoRA-Links", async () => {
    const { putNote } = await import("@/lib/server/notes");
    await expect(putNote("snippets", { id: "../x", body: "y" })).rejects.toThrow();
    const c = await putNote("characters", { id: "c1", name: "Ahri", loras: [{ name: "a.safetensors", strength: 0.8, url: "https://civitai.red/api/download/models/5?token=abc" }] });
    expect(c.loras[0].url).toBe("https://civitai.red/api/download/models/5");
  });

  it("merkt Download-Links ohne Token", async () => {
    const { saveModelLinks, getModelLinks, findLink } = await import("@/lib/server/modelRegistry");
    await saveModelLinks([{ filename: "Ahri.safetensors", type: "lora", url: "https://civitai.red/api/download/models/9?fileId=1&token=geheim" }]);
    await saveModelLinks([{ filename: "kaputt.safetensors", type: "quatsch", url: "https://x.y/z" }]);
    const links = await getModelLinks();
    expect(Object.keys(links)).toEqual(["Ahri.safetensors"]);
    expect(findLink(links, "pony/ahri.safetensors")?.url).toBe("https://civitai.red/api/download/models/9?fileId=1");
  });
});
