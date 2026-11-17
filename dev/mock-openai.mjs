// Nachbildung von POST /v1/images/edits zum lokalen Testen des Knete-Bereichs.
//   node dev/mock-openai.mjs   →  OPENAI_BASE_URL=http://127.0.0.1:8199/v1 OPENAI_API_KEY=test npm run dev
// Prüft die Felder wie die echte API grob und gibt das erste Bild (rot eingefärbt) zurück.
// Foto 99 px breit → Inhaltsfilter-Fehler, 98 px breit → einmal HTTP 500 (wird automatisch wiederholt).
import http from "node:http";
import sharp from "sharp";

const PORT = Number(process.env.MOCK_OPENAI_PORT || 8199);
const seen = new Map();

http
  .createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST" || req.url !== "/v1/images/edits") return send(404, { error: { message: "not found" } });
    if (req.headers.authorization !== "Bearer test") return send(401, { error: { message: "Incorrect API key", code: "invalid_api_key" } });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const form = await new Request("http://x", { method: "POST", headers: req.headers, body: Buffer.concat(chunks) }).formData();
    const images = form.getAll("image[]");
    const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
    console.log("[mock-openai]", { ...fields, prompt: `${String(fields.prompt).slice(0, 40)}…`, images: images.map((f) => `${f.name} ${f.size}B`) });
    if (!images.length || !fields.model || !fields.prompt) return send(400, { error: { message: "missing image[]/model/prompt" } });
    const photo = Buffer.from(await images[0].arrayBuffer());
    const meta = await sharp(photo).metadata();
    const tag = `${meta.width}x${meta.height}:${photo.length}`;
    if (images.length > 16) return send(400, { error: { message: "too many images" } });
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
    const [w, h] = fields.size && fields.size !== "auto" ? fields.size.split("x").map(Number) : [1024, 1024];
    const out = await sharp(photo).resize(w, h, { fit: "fill" }).tint({ r: 255, g: 140, b: 90 }).modulate({ saturation: 1.8 }).png().toBuffer();
    if (meta.width === 99) return send(400, { error: { message: "Your request was rejected by the safety system.", code: "moderation_blocked" } });
    if (meta.width === 98 && !seen.has(tag)) {
      seen.set(tag, 1);
      return send(500, { error: { message: "server error" } });
    }
    send(200, {
      created: Math.floor(Date.now() / 1000),
      data: [{ b64_json: out.toString("base64") }],
      usage: { input_tokens: 6200, input_tokens_details: { image_tokens: 6000, text_tokens: 200 }, output_tokens: 4200, total_tokens: 10400 },
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`[mock-openai] http://127.0.0.1:${PORT}/v1`));
