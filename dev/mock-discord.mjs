// Nachgebautes Discord (nur GET /api/v10/users/{id}) für lokale Tests: node dev/mock-discord.mjs
// App starten mit DISCORD_API_BASE=http://127.0.0.1:18881 DISCORD_BOT_TOKEN=mock-bot
import http from "node:http";

const PORT = Number(process.env.MOCK_DISCORD_PORT || 18881);
const users = { "100000000000000001": "mack_turner", "100000000000000002": "binda.art" };
http
  .createServer((req, res) => {
    const json = (c, b) => (res.writeHead(c, { "content-type": "application/json" }), res.end(JSON.stringify(b)));
    if (req.headers.authorization !== "Bot mock-bot") return json(401, { message: "401: Unauthorized" });
    const id = req.url.match(/^\/api\/v10\/users\/(\d+)$/)?.[1];
    if (id && users[id]) return json(200, { id, username: users[id], global_name: null });
    json(404, { message: "Unknown User" });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`Mock-Discord auf http://127.0.0.1:${PORT}`));
