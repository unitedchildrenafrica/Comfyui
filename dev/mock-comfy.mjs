// Mini-Attrappe von ComfyUI für lokale Entwicklung ohne Pod:
//   node dev/mock-comfy.mjs   (Port 8188)
// Simuliert /prompt, /queue, /history, /view, /upload/image, /object_info und den WebSocket.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.MOCK_PORT || 8188);
const combo = (values) => [values];
const NODES = {
  CheckpointLoaderSimple: { ckpt_name: combo(["wai_illustrious_v10.safetensors", "wai_illustrious_v17.safetensors", "ponyDiffusionV6XL.safetensors"]) },
  LoraLoader: { lora_name: combo(["detail_slider.safetensors", "style_a.safetensors"]) },
  VAELoader: { vae_name: combo(["sdxl_vae.safetensors", "qwen_image_vae.safetensors", "MiniMaxH3/minimax_h3_video_vae_fp16.safetensors", "MiniMaxH3/minimax_h3_audio_vae_fp32.safetensors"]) },
  UpscaleModelLoader: { model_name: combo(["4x_foolhardy_Remacri.pth", "4x-UltraSharp.pth"]) },
  KSampler: { sampler_name: combo(["euler", "euler_ancestral", "dpmpp_2m"]), scheduler: combo(["normal", "karras", "simple"]) },
  UNETLoader: { unet_name: combo(["anima-base-v1.0.safetensors", "Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors"]) },
  CLIPLoader: { clip_name: combo(["qwen_3_06b_base.safetensors", "qwen3vl_32b_heretic_minimax_h3_nvfp4.safetensors"]) },
  KSamplerSelect: { sampler_name: combo(["euler", "res_multistep"]) },
  BasicScheduler: { scheduler: combo(["normal", "simple", "beta"]) },
  ModelSamplingAuraFlow: {},
  MiniMaxH3Director: { mode: combo(["T2VA", "I2VA", "FL2VA", "L2VA", "REF2VA", "Image Inpaint"]) },
  ...Object.fromEntries(
    ["MiniMaxH3DirectorGuide", "DaSiWa_EnhancedVideoCombine", "DaSiWa_LTX2LoraLoader", "DaSiWa_SeedControl", "DaSiWaH3ContinuityAppend", "DaSiWaH3ContinuityPublish", "FrameInterpolationModelLoader", "ModelPreviewOverrideKJ"].map((n) => [n, {}]),
  ),
};
const KNOWN = new Set([
  ...Object.keys(NODES),
  "CLIPTextEncode", "EmptyLatentImage", "EmptySD3LatentImage", "VAEDecode", "VAEEncode", "ImageScale", "SaveImage", "ImageUpscaleWithModel",
  "CLIPSetLastLayer", "ModelSamplingSD3", "FrameInterpolate", "ModelAttentionBackend", "ComfyMathExpression", "ModelPatchTorchSettings",
  "VAEDecodeAudio", "BasicGuider", "SamplerCustomAdvanced",
]);

// 1×1-PNG (lila)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mOsb/j/HwAFVgK9VhB0xwAAAABJRU5ErkJggg==", "base64");

// Optional: MP4 für die KJ-Vorschau (wie ModelPreviewOverrideKJ mit preview_frames > 1)
const PREVIEW_MP4 = process.env.MOCK_PREVIEW_MP4 ? (await import("node:fs")).readFileSync(process.env.MOCK_PREVIEW_MP4) : null;

const queue = []; // {id, number, prompt, clientId}
let running = null;
const history = {};
let counter = 0;
const sockets = new Map();

function send(clientId, type, data) {
  for (const [ws, cid] of sockets) if (!clientId || cid === clientId) ws.send(JSON.stringify({ type, data }));
}
function sendStatus() {
  send(null, "status", { status: { exec_info: { queue_remaining: queue.length + (running ? 1 : 0) } } });
}

// Optional wie echtes ComfyUI: Ausgaben wirklich in einen Ordner schreiben (für Galerie/ZIP/Löschen)
const OUT_DIR = process.env.MOCK_OUTPUT_DIR;
async function writeOutput(sub, name, data) {
  if (!OUT_DIR) return;
  const fs = await import("node:fs/promises");
  const dir = `${OUT_DIR}/${sub}`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${dir}/${name}`, data);
}

function outputsFor(prompt) {
  const out = {};
  for (const [id, n] of Object.entries(prompt)) {
    if (n.class_type === "SaveImage") {
      const prefix = String(n.inputs.filename_prefix);
      const sub = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "";
      const base = prefix.split("/").pop();
      const filename = `${base}_${String(++counter).padStart(5, "0")}_.png`;
      writeOutput(sub, filename, PNG);
      out[id] = { images: [{ filename, subfolder: sub, type: "output" }] };
    }
    if (n.class_type === "DaSiWa_EnhancedVideoCombine") {
      const filename = `clip_${++counter}.mp4`;
      writeOutput("video/2026-10-28", filename, PREVIEW_MP4 ?? Buffer.alloc(16));
      out[id] = { gifs: [{ filename, subfolder: "video/2026-10-28", type: "output", format: "video/h264-mp4" }] };
    }
  }
  return out;
}

async function worker() {
  if (running || !queue.length) return;
  running = queue.shift();
  const { id, clientId, prompt } = running;
  sendStatus();
  const startTs = Date.now();
  send(clientId, "execution_start", { prompt_id: id, timestamp: startTs });
  // wie ComfyUI: ein Teil der Nodes kommt aus dem Cache, dann laufen die übrigen nacheinander
  const ids = Object.keys(prompt);
  const cached = ids.slice(0, Math.floor(ids.length / 3));
  send(clientId, "execution_cached", { nodes: cached, prompt_id: id, timestamp: Date.now() });
  const sampler = ids.find((k) => /Sampler/.test(prompt[k].class_type)) ?? ids[0];
  const rest = ids.slice(cached.length);
  const steps = Number(process.env.MOCK_STEPS || 8);
  for (const nodeId of rest) {
    if (running?.id !== id || running.interrupted) break;
    send(clientId, "executing", { node: nodeId, prompt_id: id });
    if (nodeId === sampler) {
      for (let i = 1; i <= steps && !running.interrupted; i++) {
        await new Promise((r) => setTimeout(r, Number(process.env.MOCK_STEP_MS || 300)));
        send(clientId, "progress", { value: i, max: steps, prompt_id: id, node: nodeId });
        if (JSON.stringify(prompt).includes("ModelPreviewOverrideKJ"))
          send(clientId, "kj_preview_override", {
            node_id: "2737",
            image: (PREVIEW_MP4 ?? PNG).toString("base64"),
            mime: PREVIEW_MP4 ? "video/mp4" : "image/png",
            step: i,
            total: steps,
          });
        const head = Buffer.alloc(8);
        head.writeUInt32BE(1, 0);
        head.writeUInt32BE(2, 4);
        for (const [ws, cid] of sockets) if (cid === clientId) ws.send(Buffer.concat([head, PNG]));
      }
    } else {
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  const ok = !running.interrupted;
  const fail = JSON.stringify(prompt).includes("FAIL_ME");
  history[id] = {
    prompt: [running.number, id, prompt, {}, []],
    outputs: ok && !fail ? outputsFor(prompt) : {},
    status: {
      status_str: ok && !fail ? "success" : "error",
      completed: ok && !fail,
      messages: [
        ["execution_start", { prompt_id: id, timestamp: startTs }],
        fail
          ? ["execution_error", { prompt_id: id, exception_message: "Simulierter Fehler", timestamp: Date.now() }]
          : [ok ? "execution_success" : "execution_interrupted", { prompt_id: id, timestamp: Date.now() }],
      ],
    },
  };
  if (!ok) send(clientId, "execution_interrupted", { prompt_id: id });
  else if (fail) send(clientId, "execution_error", { prompt_id: id, node_id: "7", node_type: "KSampler", exception_message: "Simulierter Fehler" });
  else send(clientId, "execution_success", { prompt_id: id });
  send(clientId, "executing", { node: null, prompt_id: id });
  running = null;
  sendStatus();
  setTimeout(worker, 50);
}

function body(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
const json = (res, data, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/system_stats") return json(res, { system: { comfyui_version: "mock-0.3", python_version: "3.12", pytorch_version: "2.9", ram_total: 64e9, ram_free: 40e9 }, devices: [{ name: "cuda:0 NVIDIA GeForce RTX 5090 (Mock)", type: "cuda", vram_total: 32e9, vram_free: 20e9 }] });
  if (p.startsWith("/object_info/")) {
    const cls = decodeURIComponent(p.slice("/object_info/".length));
    return json(res, NODES[cls] ? { [cls]: { input: { required: NODES[cls] } } } : {});
  }
  if (p === "/prompt" && req.method === "POST") {
    const { prompt, client_id } = JSON.parse((await body(req)).toString());
    const node_errors = {};
    for (const [id, n] of Object.entries(prompt)) {
      if (!KNOWN.has(n.class_type)) node_errors[id] = { class_type: n.class_type, errors: [{ message: "Unbekannte Node-Klasse" }] };
      for (const [k, v] of Object.entries(n.inputs)) {
        if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && !prompt[v[0]])
          node_errors[id] = { class_type: n.class_type, errors: [{ message: `Link auf fehlende Node ${v[0]}`, extra_info: { input_name: k } }] };
        if (k === "ckpt_name" && !NODES.CheckpointLoaderSimple.ckpt_name[0].includes(v))
          node_errors[id] = { class_type: n.class_type, errors: [{ message: "Value not in list", extra_info: { input_name: k, received_value: v } }] };
      }
    }
    if (Object.keys(node_errors).length) return json(res, { error: { message: "Prompt outputs failed validation" }, node_errors }, 400);
    const id = randomUUID();
    queue.push({ id, number: ++counter, prompt, clientId: client_id });
    sendStatus();
    setTimeout(worker, 10);
    return json(res, { prompt_id: id, number: counter, node_errors: {} });
  }
  if (p === "/queue" && req.method === "GET") {
    const row = (q) => [q.number, q.id, q.prompt, {}, []];
    return json(res, { queue_running: running ? [row(running)] : [], queue_pending: queue.map(row) });
  }
  if (p === "/queue" && req.method === "POST") {
    const b = JSON.parse((await body(req)).toString() || "{}");
    if (b.clear) queue.length = 0;
    if (b.delete) for (const d of b.delete) { const i = queue.findIndex((q) => q.id === d); if (i >= 0) queue.splice(i, 1); }
    sendStatus();
    return json(res, {});
  }
  if (p === "/interrupt") {
    const b = JSON.parse((await body(req)).toString() || "{}");
    if (running && (!b.prompt_id || b.prompt_id === running.id)) running.interrupted = true;
    return json(res, {});
  }
  if (p === "/free") return json(res, {});
  if (p === "/history") {
    const max = Number(url.searchParams.get("max_items") || 1e9);
    return json(res, Object.fromEntries(Object.entries(history).slice(-max)));
  }
  if (p.startsWith("/history/")) {
    const id = p.slice("/history/".length);
    return json(res, history[id] ? { [id]: history[id] } : {});
  }
  if (p === "/view") {
    const f = url.searchParams.get("filename") || "";
    if (/\.(mp4|wav|mp3)$/.test(f)) { res.writeHead(200, { "content-type": f.endsWith(".mp4") ? "video/mp4" : "audio/wav" }); return res.end(Buffer.alloc(16)); }
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(PNG);
  }
  if (p === "/upload/image" && req.method === "POST") {
    const raw = (await body(req)).toString("latin1");
    const name = raw.match(/filename="([^"]+)"/)?.[1] ?? "upload.png";
    return json(res, { name, subfolder: "", type: "input" });
  }
  json(res, { error: "not found" }, 404);
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname !== "/ws") return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.set(ws, url.searchParams.get("clientId"));
    ws.on("close", () => sockets.delete(ws));
    ws.send(JSON.stringify({ type: "status", data: { status: { exec_info: { queue_remaining: queue.length } }, sid: url.searchParams.get("clientId") } }));
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`Mock-ComfyUI auf http://127.0.0.1:${PORT}`));
