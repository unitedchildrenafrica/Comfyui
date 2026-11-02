// Nachgebautes Patreon (API v2) für lokale Tests: node dev/mock-patreon.mjs  (Port MOCK_PATREON_PORT, Standard 18880)
// Token: „mock-token“. App starten mit PATREON_API_BASE=http://127.0.0.1:18880 PATREON_ACCESS_TOKEN=mock-token
import http from "node:http";

const PORT = Number(process.env.MOCK_PATREON_PORT || 18880);
const d = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
const people = [
  ["1", "Mack Turner", "ic", "active_patron", d(-1), "Paid", "2026-09-02"],
  ["2", "Binda", "ic", "active_patron", d(-3), "Paid", d(-3)],
  ["3", "Sam Manson", "ic", "declined_patron", d(-2), "Declined", "2026-06-01"],
  ["4", "Lena K.", "ic", "active_patron", d(-20), "Paid", "2026-03-01"],
  ["5", "Fan Fritz", "fan", "active_patron", d(-5), "Paid", "2026-01-01"],
  ["6", "Old Otto", "ic", "former_patron", d(-90), "Paid", "2025-01-01"],
];
http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const json = (c, b) => (res.writeHead(c, { "content-type": "application/json" }), res.end(JSON.stringify(b)));
    if (req.headers.authorization !== "Bearer mock-token") return json(401, {});
    if (url.pathname === "/api/oauth2/v2/campaigns")
      return json(200, {
        data: [{ id: "c1", type: "campaign", attributes: {} }],
        included: [
          { id: "fan", type: "tier", attributes: { title: "Fan", amount_cents: 500 } },
          { id: "ic", type: "tier", attributes: { title: "Inner Circle", amount_cents: 2500 } },
        ],
      });
    if (url.pathname === "/api/oauth2/v2/campaigns/c1/members")
      return json(200, {
        data: people.map(([id, name, tier, status, last, lastStatus, since]) => ({
          id,
          type: "member",
          attributes: { full_name: name, email: `${id}@example.com`, patron_status: status, last_charge_date: last, last_charge_status: lastStatus, next_charge_date: d(28), pledge_relationship_start: since },
          relationships: { currently_entitled_tiers: { data: [{ id: tier, type: "tier" }] }, user: { data: { id: `u${id}`, type: "user" } } },
        })),
        included: people.map(([id]) => ({ id: `u${id}`, type: "user", attributes: { url: `https://www.patreon.com/user?u=${id}` } })),
        meta: { pagination: { cursors: { next: null } } },
      });
    json(404, {});
  })
  .listen(PORT, "127.0.0.1", () => console.log(`Mock-Patreon auf http://127.0.0.1:${PORT}`));
