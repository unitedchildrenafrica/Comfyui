import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(path.join(tmpdir(), "circle-"));
const member = (id: string, name: string, lastCharge: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  status: "active_patron",
  lastCharge,
  lastChargeStatus: "Paid",
  nextCharge: "2026-12-12T08:00:00.000+00:00",
  since: "2026-10-12T08:00:00.000+00:00",
  cents: 4400,
  cadence: 1,
  tierIds: ["ic"],
  url: null,
});

beforeAll(() => {
  process.env.DATA_DIR = root;
  delete process.env.PATREON_ACCESS_TOKEN;
  delete process.env.PATREON_REFRESH_TOKEN;
  writeFileSync(
    path.join(root, "patreon-members.json"),
    JSON.stringify({
      syncedAt: Date.now(),
      campaignId: "c1",
      tiers: [{ id: "ic", title: "Inner Circle", amountCents: 4400 }],
      members: [member("m1", "Mark D", "2026-11-12T08:00:00.000+00:00"), member("m2", "Beanman", "2026-11-14T08:00:00.000+00:00")],
    }),
  );
  writeFileSync(path.join(root, "patreon-acks.json"), JSON.stringify({ m2: "2026-11-14T08:00:00.000+00:00" }));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const store = () => JSON.parse(readFileSync(path.join(root, "inner-circle.json"), "utf8"));

describe("Inner-Circle-Speicher", () => {
  it("zeigt Patreon-Mitglieder und übernimmt alte Häkchen einmal", async () => {
    const c = await import("@/lib/server/circle");
    const v = await c.circleView();
    expect(v.rows.map((r) => r.name).sort()).toEqual(["Beanman", "Mark D"]);
    expect(v.rows.find((r) => r.key === "m2")!.cycle.contacted).toBe("yes");
    expect(v.rows.find((r) => r.key === "m1")!.state).toBe("contact");
    const again = await c.circleView();
    expect(again.rows.find((r) => r.key === "m2")!.cycle.contacted).toBe("yes");
    expect(store().acksMigrated).toBe(true);
  });

  it("gleichzeitige Änderungen gehen nicht verloren", async () => {
    const c = await import("@/lib/server/circle");
    await Promise.all([
      c.setCycleField("m1", "2026-11-12", "contacted", "yes"),
      c.setCycleField("m1", "2026-11-12", "set", "  Bombchu 200 "),
      c.setPersonField("m1", "discord", ".agnikai"),
    ]);
    const s = store();
    expect(s.cycles.m1["2026-11-12"]).toMatchObject({ contacted: "yes", set: "Bombchu 200" });
    expect(s.people.m1.discord).toBe(".agnikai");
  });

  it("Antwort Ja merkt sich das Datum, null löscht das Feld", async () => {
    const c = await import("@/lib/server/circle");
    await c.setCycleField("m1", "2026-11-12", "answer", "yes");
    expect(typeof store().cycles.m1["2026-11-12"].answerAt).toBe("number");
    await c.setCycleField("m1", "2026-11-12", "contacted", null);
    expect(store().cycles.m1["2026-11-12"].contacted).toBeUndefined();
  });

  it("lehnt Unbekanntes und Überlanges ab, Speicher bleibt gleich", async () => {
    const c = await import("@/lib/server/circle");
    const before = JSON.stringify(store());
    await expect(c.setCycleField("gibtsnicht", "start", "contacted", "yes")).rejects.toBeInstanceOf(c.CircleError);
    await expect(c.setPersonField("m1", "discord", "x".repeat(101))).rejects.toBeInstanceOf(c.CircleError);
    await expect(c.setCycleField("m1", "2026-11-12", "contacted", "vielleicht" as never)).rejects.toBeInstanceOf(c.CircleError);
    await expect(c.setCycleField("m1", "../x", "contacted", "yes")).rejects.toBeInstanceOf(c.CircleError);
    await expect(c.editManual("m_gibtsnicht0", { name: "x" })).rejects.toBeInstanceOf(c.CircleError);
    expect(JSON.stringify(store())).toBe(before);
  });

  it("Hand-Mitglied anlegen, Zahlung erhalten, löschen", async () => {
    const c = await import("@/lib/server/circle");
    const key = await c.addManual({ name: "Falcon", cents: 4400, yearly: true, lastCharge: "2025-06-15", nextCharge: "2027-06-15" });
    expect(key).toMatch(/^m_[A-Za-z0-9]{12}$/);
    let row = (await c.circleView()).rows.find((r) => r.key === key)!;
    expect(row).toMatchObject({ source: "manual", monthlyCents: 4400, cycleId: "2025-06-15" });
    await c.setCycleField(key, "2025-06-15", "set", "Lake Hylia");
    await c.paidManual(key, "2026-11-26");
    row = (await c.circleView()).rows.find((r) => r.key === key)!;
    expect(row).toMatchObject({ nextCharge: "2027-11-26", lastCharge: "2026-11-26", cycleId: "2026-11-26" });
    expect(row.history[0]).toMatchObject({ cycleId: "2025-06-15", data: { set: "Lake Hylia" } });
    await c.editManual(key, { ended: true });
    expect((await c.circleView()).rows.find((r) => r.key === key)!.state).toBe("former");
    await c.removeManual(key);
    expect((await c.circleView()).rows.find((r) => r.key === key)).toBeUndefined();
    expect(store().cycles[key]).toBeUndefined();
  });

  it("monatlicher Hand-Zahler: nächste Zahlung + 1 Monat, Monatsende bleibt gültig", async () => {
    const c = await import("@/lib/server/circle");
    const key = await c.addManual({ name: "Monat" });
    await c.paidManual(key, "2026-01-31");
    expect((await c.circleView()).rows.find((r) => r.key === key)!.nextCharge).toBe("2026-02-28");
    await expect(c.addManual({ name: "  " })).rejects.toBeInstanceOf(c.CircleError);
    await c.removeManual(key);
  });

  it("ohne Patreon-Stand: nur Hand-Mitglieder, kein Fehler", async () => {
    const c = await import("@/lib/server/circle");
    rmSync(path.join(root, "patreon-members.json"));
    const key = await c.addManual({ name: "Ohne Patreon" });
    const v = await c.circleView();
    expect(v.rows.map((r) => r.key)).toEqual([key]);
    expect(v.syncedAt).toBeNull();
  });
});

describe("Schlussprüfung: Speicher", () => {
  it("erster Tipp im ersten Zahlungsmonat verschiebt start, statt ihn zu kopieren", async () => {
    const c = await import("@/lib/server/circle");
    writeFileSync(
      path.join(root, "patreon-members.json"),
      JSON.stringify({ syncedAt: Date.now(), campaignId: "c1", tiers: [{ id: "ic", title: "Inner Circle", amountCents: 4400 }], members: [member("p9", "Neu", "2026-11-20T08:00:00.000+00:00")] }),
    );
    await c.updateStore((s) => {
      s.cycles.p9 = { start: { set: "Bombchu", updatedAt: 1 } };
    });
    await c.setCycleField("p9", "2026-11-20", "contacted", "yes");
    const s = store();
    expect(s.cycles.p9.start).toBeUndefined();
    expect(s.cycles.p9["2026-11-20"]).toMatchObject({ set: "Bombchu", contacted: "yes" });
    // spätere Zahlung: kein Übertrag mehr
    await c.setCycleField("p9", "2026-12-20", "answer", "no");
    expect(store().cycles.p9["2026-12-20"].set).toBeUndefined();
  });

  it("unbekannte Personen-Felder (auch aus dem Prototyp) werden abgelehnt", async () => {
    const c = await import("@/lib/server/circle");
    const before = JSON.stringify(store());
    for (const f of ["constructor", "toString", "valueOf", "__proto__"]) {
      await expect(c.setPersonField("p9", f as "note", "x".repeat(5000))).rejects.toBeInstanceOf(c.CircleError);
    }
    expect(JSON.stringify(store())).toBe(before);
  });

  it("kaputte Speicherdatei wird nie mit einem leeren Stand überschrieben", async () => {
    const c = await import("@/lib/server/circle");
    const file = path.join(root, "inner-circle.json");
    writeFileSync(file, "{ kaputt");
    await expect(c.setPersonField("p9", "discord", "x")).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe("{ kaputt");
  });
});

describe("Discord-Namen in der Ansicht", () => {
  it("zeigt gemerkte Discord-Namen und meldet, ob der Bot eingerichtet ist", async () => {
    const c = await import("@/lib/server/circle");
    writeFileSync(
      path.join(root, "patreon-members.json"),
      JSON.stringify({
        syncedAt: Date.now(),
        campaignId: "c1",
        tiers: [{ id: "ic", title: "Inner Circle", amountCents: 4400 }],
        members: [{ ...member("d1", "Mit Discord", "2026-11-20T08:00:00.000+00:00"), discordId: "111111111111111111" }],
      }),
    );
    writeFileSync(path.join(root, "inner-circle.json"), JSON.stringify({ people: {}, cycles: {}, acksMigrated: true }));
    writeFileSync(path.join(root, "discord-names.json"), JSON.stringify({ "111111111111111111": { username: "agnikai", fetchedAt: Date.now() } }));
    delete process.env.DISCORD_BOT_TOKEN;
    const v = await c.circleView();
    expect(v.rows.find((r) => r.key === "d1")).toMatchObject({ discord: "agnikai", discordAuto: true });
    expect(v.discordConfigured).toBe(false);
  });
});
