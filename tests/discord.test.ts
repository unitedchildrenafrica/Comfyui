import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "discord-"));
const hits: { url: string; auth: string }[] = [];
let server: http.Server;
let mode: "ok" | "401" | "429" | "429-kurz" = "ok";
/** „429-kurz“: nur die nächste Anfrage wird gebremst (retry_after 0,05 s), danach geht es weiter */
let shortLimitsLeft = 0;

const USERS: Record<string, { username: string; global_name: string | null }> = {
  "111111111111111111": { username: "agnikai", global_name: "Mark" },
  "222222222222222222": { username: "vibesbibes111e_03095", global_name: null },
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push({ url: req.url!, auth: String(req.headers.authorization ?? "") });
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (mode === "401") return json(401, { message: "401: Unauthorized" });
    if (mode === "429") return json(429, { retry_after: 60 });
    if (mode === "429-kurz" && shortLimitsLeft > 0) {
      shortLimitsLeft--;
      return json(429, { retry_after: 0.05 });
    }
    if (req.headers.authorization !== "Bot test-token") return json(401, {});
    const id = req.url!.match(/^\/api\/v10\/users\/(\d+)$/)?.[1];
    const u = id && USERS[id];
    if (u) return json(200, { id, ...u });
    return json(404, { message: "Unknown User" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  Object.assign(process.env, {
    DATA_DIR: dir,
    DISCORD_API_BASE: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    DISCORD_BOT_TOKEN: "test-token",
  });
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Discord-Namen", () => {
  it("holt Benutzernamen per Bot-Token und merkt unbekannte IDs", async () => {
    const d = await import("@/lib/server/discord");
    await d.refreshDiscordNames(["111111111111111111", "222222222222222222", "333333333333333333"]);
    expect(await d.discordNameMap()).toEqual({ "111111111111111111": "agnikai", "222222222222222222": "vibesbibes111e_03095" });
    expect(hits.every((h) => h.auth === "Bot test-token")).toBe(true);
    const saved = JSON.parse(readFileSync(path.join(dir, "discord-names.json"), "utf8"));
    expect(saved["333333333333333333"].missing).toBe(true);
    expect(d.discordError()).toBeNull();
  });

  it("fragt innerhalb von 24 Stunden nicht erneut und ignoriert ungültige IDs", async () => {
    const d = await import("@/lib/server/discord");
    const before = hits.length;
    await d.refreshDiscordNames(["111111111111111111", "../../etc", "12"]);
    expect(hits.length).toBe(before);
    await d.refreshDiscordNames(["111111111111111111"], Date.now() + 25 * 3600_000);
    expect(hits.length).toBe(before + 1);
  });

  it("falscher Token: klare Meldung ohne den Token, Namen bleiben", async () => {
    const d = await import("@/lib/server/discord");
    mode = "401";
    await d.refreshDiscordNames(["111111111111111111"], Date.now() + 50 * 3600_000);
    expect(d.discordError()).toMatch(/Token/);
    expect(d.discordError()).not.toContain("test-token");
    expect((await d.discordNameMap())["111111111111111111"]).toBe("agnikai");
  });

  it("Discord bremst kurz (429 mit kleiner Wartezeit): warten und weitermachen", async () => {
    const d = await import("@/lib/server/discord");
    mode = "429-kurz";
    shortLimitsLeft = 1;
    await d.refreshDiscordNames(["111111111111111111", "222222222222222222"], Date.now() + 60 * 3600_000);
    const saved = JSON.parse(readFileSync(path.join(dir, "discord-names.json"), "utf8"));
    expect(saved["222222222222222222"].fetchedAt).toBeGreaterThan(Date.now() + 59 * 3600_000);
    expect(saved["111111111111111111"].fetchedAt).toBeGreaterThan(Date.now() + 59 * 3600_000);
    mode = "ok";
  });

  it("Discord bremst lange (429): Abbruch ohne Fehler-Spam, nächster Durchlauf geht weiter", async () => {
    const d = await import("@/lib/server/discord");
    mode = "429";
    const before = hits.length;
    await d.refreshDiscordNames(["111111111111111111", "222222222222222222"], Date.now() + 90 * 3600_000);
    expect(hits.length).toBe(before + 1);
    mode = "ok";
    await d.refreshDiscordNames(["111111111111111111"], Date.now() + 90 * 3600_000);
    expect(d.discordError()).toBeNull();
  });

  it("ohne Token: nichts abfragen", async () => {
    const d = await import("@/lib/server/discord");
    const token = process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_BOT_TOKEN;
    const before = hits.length;
    expect(d.discordConfigured()).toBe(false);
    await d.refreshDiscordNames(["111111111111111111"], Date.now() + 120 * 3600_000);
    expect(hits.length).toBe(before);
    process.env.DISCORD_BOT_TOKEN = token;
  });
});

describe("Welche Discord-IDs abfragen", () => {
  it("nur Mitglieder der gewählten Stufen, die noch dabei sind – ohne Doppelte", async () => {
    const { discordIdsToFetch } = await import("@/lib/patreon");
    const m = (id: string, status: string | null, tier: string, discordId: string | null) => ({ status, tierIds: [tier], discordId, id });
    const members = [
      m("1", "active_patron", "ic", "111111111111111111"),
      m("2", "former_patron", "ic", "222222222222222222"),
      m("3", "active_patron", "fan", "333333333333333333"),
      m("4", "declined_patron", "ic", "444444444444444444"),
      m("5", "active_patron", "ic", null),
      m("6", "active_patron", "ic", "111111111111111111"),
    ];
    expect(discordIdsToFetch(members, ["ic"])).toEqual(["111111111111111111", "444444444444444444"]);
    expect(discordIdsToFetch(members, null)).toEqual(["111111111111111111", "333333333333333333", "444444444444444444"]);
  });
});
