// Pod-Gateway: einziger Zugang von außen (über den Cloudflare-Tunnel) zum GPU-Pod.
// Lässt nur Anfragen mit dem richtigen POD_SECRET durch – per Header x-pod-secret oder bei
// WebSockets per ?pod_secret=… – und leitet weiter:
//   /_app/…  → Pod-Frontend (z. B. „Modelle laden“), sonst → ComfyUI (HTTP + WebSocket)
// Ohne Abhängigkeiten, nur Node-Bordmittel.
import http from "node:http";
import net from "node:net";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.GATEWAY_PORT || 18189);
const SECRET = process.env.POD_SECRET || "";
const COMFY = new URL(process.env.COMFY_URL || "http://127.0.0.1:18188");
const APP = new URL(process.env.APP_URL || "http://127.0.0.1:3000");

if (SECRET.length < 16) {
  console.error("POD_SECRET fehlt oder ist zu kurz (mind. 16 Zeichen)");
  process.exit(1);
}

function ok(token) {
  if (typeof token !== "string" || token.length !== SECRET.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(SECRET));
}

/** Prüft das Geheimnis und liefert Ziel + bereinigten Pfad. */
function route(req) {
  const u = new URL(req.url || "/", "http://x");
  const token = req.headers["x-pod-secret"] ?? u.searchParams.get("pod_secret");
  if (!ok(Array.isArray(token) ? token[0] : token)) return null;
  u.searchParams.delete("pod_secret");
  const qs = u.searchParams.toString();
  if (u.pathname === "/_app" || u.pathname.startsWith("/_app/")) {
    return { target: APP, path: (u.pathname.slice("/_app".length) || "/") + (qs ? `?${qs}` : "") };
  }
  return { target: COMFY, path: u.pathname + (qs ? `?${qs}` : "") };
}

function forwardHeaders(req, target) {
  const h = { ...req.headers, host: target.host };
  // ComfyUI prüft Origin gegen Host – vom Server kommt sonst ein fremder Origin
  delete h.origin;
  delete h.referer;
  return h;
}

const server = http.createServer((req, res) => {
  if (req.url === "/_health") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }
  const r = route(req);
  if (!r) {
    res.writeHead(401, { "content-type": "text/plain" });
    return res.end("unauthorized");
  }
  const up = http.request(
    { hostname: r.target.hostname, port: r.target.port, method: req.method, path: r.path, headers: forwardHeaders(req, r.target) },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    },
  );
  up.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`upstream: ${err.message}`);
  });
  req.pipe(up);
});

// WebSocket (ComfyUI /ws): Verbindung roh durchreichen
server.on("upgrade", (req, socket, head) => {
  const r = route(req);
  if (!r) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  const upstream = net.connect(Number(r.target.port), r.target.hostname, () => {
    const headers = forwardHeaders(req, r.target);
    let raw = `${req.method} ${r.path} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(headers)) {
      for (const val of Array.isArray(v) ? v : [v]) if (val !== undefined) raw += `${k}: ${val}\r\n`;
    }
    upstream.write(raw + "\r\n");
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on("error", close);
  socket.on("error", close);
});

server.listen(PORT, "127.0.0.1", () => console.log(`[pod-gateway] lauscht auf 127.0.0.1:${PORT} → ComfyUI ${COMFY.host}, App ${APP.host}`));
