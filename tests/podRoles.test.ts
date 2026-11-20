import { describe, expect, it } from "vitest";
import { type PodInfo, assignRoles, cleanPodId, toKind } from "@/lib/podRoles";

const now = 1_000_000_000;
const pod = (id: string, kind: PodInfo["kind"], extra: Partial<PodInfo> = {}): PodInfo => ({
  id,
  url: `https://${id}.example`,
  kind,
  registeredAt: now - 60_000,
  lastSeen: now - 10_000,
  ...extra,
});

describe("Pod-Rollen", () => {
  it("ein Pod macht beides – egal welches Setup", () => {
    for (const k of ["alles", "bilder", "video"] as const) expect(assignRoles([pod("a", k)], now)).toEqual({ bild: "a", video: "a" });
  });

  it("alter Pod „alles“ + neuer Pod „bilder“ → Video bleibt, Bilder gehen auf den neuen", () => {
    expect(assignRoles([pod("alt", "alles", { registeredAt: now - 3_600_000 }), pod("neu", "bilder")], now)).toEqual({ bild: "neu", video: "alt" });
  });

  it("zwei Pods „alles“: der ältere macht Video, der neuere Bilder", () => {
    expect(assignRoles([pod("b", "alles", { registeredAt: now - 1000 }), pod("a", "alles", { registeredAt: now - 5000 })], now)).toEqual({ bild: "b", video: "a" });
  });

  it("Pod „video“ + Pod „alles“ → alles macht Bilder", () => {
    expect(assignRoles([pod("x", "alles", { registeredAt: now - 9000 }), pod("v", "video")], now)).toEqual({ bild: "x", video: "v" });
  });

  it("festgelegte Rollen haben Vorrang", () => {
    const pods = [pod("alt", "alles", { registeredAt: now - 9000, pin: "bild" }), pod("neu", "alles", { pin: "video" })];
    expect(assignRoles(pods, now)).toEqual({ bild: "alt", video: "neu" });
  });

  it("getrennte Pods werden ignoriert – der verbleibende macht dann beides", () => {
    const pods = [pod("alt", "alles"), pod("weg", "bilder", { lastSeen: now - 10 * 60_000 })];
    expect(assignRoles(pods, now)).toEqual({ bild: "alt", video: "alt" });
    expect(assignRoles([], now)).toEqual({ bild: null, video: null });
  });

  it("Kennung und Setup-Art aus der Anmeldung werden abgesichert", () => {
    expect(cleanPodId("C.60989969")).toBe("C.60989969");
    expect(cleanPodId(undefined)).toBe("legacy");
    expect(cleanPodId("../x")).toBe("legacy");
    expect(toKind("bilder")).toBe("bilder");
    expect(toKind("quatsch")).toBe("alles");
  });
});

describe("Pod-Anmeldung", () => {
  it("merkt sich mehrere Pods, übernimmt alte pod.json, Rollen bleiben bei spätem Lebenszeichen stabil", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = mkdtempSync(path.join(tmpdir(), "pods-"));
    process.env.DATA_DIR = dir;
    writeFileSync(path.join(dir, "pod.json"), JSON.stringify({ url: "https://alt.example", gpu: "RTX 4090", registeredAt: 1, lastSeen: Date.now() }));
    (globalThis as { __pods?: unknown }).__pods = undefined;
    const pl = await import("@/lib/server/podLink");
    expect(pl.getPods().map((p) => [p.id, p.kind])).toEqual([["legacy", "alles"]]);
    await pl.registerPod({ id: "neu", url: "https://neu.example", kind: "bilder" });
    expect(pl.podRoles()).toEqual({ bild: "neu", video: "legacy" });
    // gleiche Kennung, neue Adresse → kein zweiter Eintrag
    const again = await pl.registerPod({ id: "neu", url: "https://neu2.example", kind: "bilder" });
    expect(again.changed).toBe(true);
    expect(pl.getPods()).toHaveLength(2);
    // Lebenszeichen des alten Pods kommt spät (60 s + Selbsttest) → er bleibt, Rollen bleiben stabil
    pl.getPod("legacy")!.lastSeen = Date.now() - 80_000;
    const since = pl.getPod("legacy")!.registeredAt;
    await pl.registerPod({ id: "neu", url: "https://neu2.example", kind: "bilder" });
    expect(pl.getPods().map((p) => p.id).sort()).toEqual(["legacy", "neu"]);
    expect(pl.podRoles()).toEqual({ bild: "neu", video: "legacy" });
    await pl.registerPod({ id: "legacy", url: "https://alt.example", kind: "alles" });
    expect(pl.getPod("legacy")!.registeredAt).toBe(since);
    expect(pl.podRoles()).toEqual({ bild: "neu", video: "legacy" });
    // erst nach 3 Minuten ohne Lebenszeichen gilt er als getrennt → der andere macht beides
    pl.getPod("legacy")!.lastSeen = Date.now() - 4 * 60_000;
    expect(pl.podRoles()).toEqual({ bild: "neu", video: "neu" });
    pl.getPod("legacy")!.lastSeen = Date.now();
    // Kontext: withRole wählt den Pod, comfyUrl folgt
    const { config } = await import("@/lib/server/config");
    process.env.SERVER_MODE = "1";
    expect(pl.withRole("video", () => config.comfyUrl)).toBe("https://alt.example");
    expect(pl.withRole("bild", () => config.comfyUrl)).toBe("https://neu2.example");
    delete process.env.SERVER_MODE;
  });
});
