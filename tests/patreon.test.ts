import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type PatreonMember, memberState, viewMembers } from "@/lib/patreon";

const member = (p: Partial<PatreonMember>): PatreonMember => ({
  id: "m1",
  name: "Max",
  email: "",
  status: "active_patron",
  lastCharge: "2026-11-01T08:00:00.000+00:00",
  lastChargeStatus: "Paid",
  nextCharge: "2026-12-01T08:00:00.000+00:00",
  since: "2026-09-01T08:00:00.000+00:00",
  cents: 2000,
  cadence: 1,
  tierIds: ["ic"],
  url: null,
  ...p,
});

describe("Anschreiben-Logik", () => {
  it("neue Zahlung → anschreiben, nach Häkchen Pause bis zur nächsten", () => {
    const m = member({});
    expect(memberState(m, undefined)).toBe("contact");
    expect(memberState(m, m.lastCharge)).toBe("done");
    // nächster Monat: neue Abbuchung → wieder anschreiben
    expect(memberState({ ...m, lastCharge: "2026-12-01T08:00:00.000+00:00" }, m.lastCharge)).toBe("contact");
  });

  it("abgelehnt, ausstehend, ehemalig", () => {
    expect(memberState(member({ status: "declined_patron" }), undefined)).toBe("declined");
    expect(memberState(member({ lastChargeStatus: "Declined" }), undefined)).toBe("declined");
    expect(memberState(member({ lastChargeStatus: "Pending" }), undefined)).toBe("waiting");
    expect(memberState(member({ status: "former_patron" }), undefined)).toBe("former");
  });

  it("filtert nach Stufen und sortiert Anschreiben nach oben", () => {
    const list = viewMembers(
      [member({ id: "a", name: "Anna", tierIds: ["fan"] }), member({ id: "b", name: "Ben" }), member({ id: "c", name: "Cleo" })],
      { b: "2026-11-01T08:00:00.000+00:00" },
      ["ic"],
    );
    expect(list.map((m) => [m.name, m.state])).toEqual([
      ["Cleo", "contact"],
      ["Ben", "done"],
    ]);
  });
});

// --- Abfrage gegen ein nachgebautes Patreon -----------------------------------------------
const dir = mkdtempSync(path.join(tmpdir(), "patreon-"));
let server: http.Server;
const seen: { auth: string; url: string }[] = [];
let validToken = "neu-access";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    seen.push({ auth: String(req.headers.authorization ?? ""), url: req.url! });
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/api/oauth2/token") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const p = new URLSearchParams(body);
        if (p.get("refresh_token") === "start-refresh" && p.get("client_secret") === "geheim") json(200, { access_token: validToken, refresh_token: "neu-refresh", expires_in: 2678400 });
        else json(401, { error: "invalid_grant" });
      });
      return;
    }
    if (req.headers.authorization !== `Bearer ${validToken}`) return json(401, { errors: [] });
    if (url.pathname === "/api/oauth2/v2/campaigns")
      return json(200, {
        data: [{ id: "camp1", type: "campaign", attributes: {} }],
        included: [
          { id: "ic", type: "tier", attributes: { title: "Inner Circle", amount_cents: 2000 } },
          { id: "fan", type: "tier", attributes: { title: "Fan", amount_cents: 500 } },
        ],
      });
    if (url.pathname === "/api/oauth2/v2/campaigns/camp1/members") {
      const cursor = url.searchParams.get("page[cursor]");
      const mk = (id: string, name: string, tier: string) => ({
        id,
        type: "member",
        attributes: { full_name: name, patron_status: "active_patron", last_charge_date: "2026-11-01T08:00:00.000+00:00", last_charge_status: "Paid", next_charge_date: "2026-12-01T08:00:00.000+00:00" },
        relationships: { currently_entitled_tiers: { data: [{ id: tier, type: "tier" }] }, user: { data: { id: `u${id}`, type: "user" } } },
      });
      if (!cursor)
        return json(200, {
          data: [mk("1", "Anna", "fan"), mk("2", "Ben", "ic")],
          included: [{ id: "u2", type: "user", attributes: { url: "https://www.patreon.com/ben" } }],
          meta: { pagination: { cursors: { next: "seite2" } } },
        });
      return json(200, { data: [mk("3", "Cleo", "ic")], meta: { pagination: { cursors: { next: null } } } });
    }
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  Object.assign(process.env, {
    DATA_DIR: dir,
    PATREON_API_BASE: `http://127.0.0.1:${port}`,
    PATREON_ACCESS_TOKEN: "alt-abgelaufen",
    PATREON_REFRESH_TOKEN: "start-refresh",
    PATREON_CLIENT_ID: "id",
    PATREON_CLIENT_SECRET: "geheim",
  });
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Patreon-Abfrage", () => {
  it("erneuert abgelaufene Tokens, blättert durch alle Seiten, wählt Inner Circle", async () => {
    const { syncPatreon, getTrackedTiers } = await import("@/lib/server/patreon");
    const snap = await syncPatreon();
    expect(snap.members.map((m) => m.name)).toEqual(["Anna", "Ben", "Cleo"]);
    expect(snap.members[1].url).toBe("https://www.patreon.com/ben");
    expect(snap.tiers.map((t) => t.title)).toEqual(["Fan", "Inner Circle"]);
    expect(seen[0].auth).toBe("Bearer alt-abgelaufen");
    expect(seen.some((s) => s.url.includes("page%5Bcursor%5D=seite2") || s.url.includes("page[cursor]=seite2"))).toBe(true);
    expect(await getTrackedTiers(snap)).toEqual(["ic"]);
    const view = viewMembers(snap.members, {}, ["ic"]);
    expect(view.map((m) => m.name)).toEqual(["Ben", "Cleo"]);
  });

  it("speichert erneuerte Tokens nur für den Dienst lesbar", async () => {
    const { statSync, readFileSync } = await import("node:fs");
    const f = path.join(dir, "patreon-tokens.json");
    expect(JSON.parse(readFileSync(f, "utf8")).refresh).toBe("neu-refresh");
    expect(statSync(f).mode & 0o077).toBe(0);
  });
});
