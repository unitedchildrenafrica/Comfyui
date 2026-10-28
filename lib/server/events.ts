import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { config } from "./config";

export interface JobError {
  message: string;
  nodeId?: string;
  nodeType?: string;
}

export interface LiveState {
  connected: boolean;
  runningPromptId: string | null;
  node: string | null;
  progress: { value: number; max: number } | null;
  queueRemaining: number;
  previewSeq: number;
  /** prompt_id → Ergebnis, nur für Jobs seit App-Start */
  finished: Record<string, "success" | "error" | "interrupted">;
  errors: Record<string, JobError>;
}

interface Hub {
  clientId: string;
  emitter: EventEmitter;
  state: LiveState;
  preview: { data: Buffer; mime: string } | null;
  ws: WebSocket | null;
  retry: ReturnType<typeof setTimeout> | null;
}

const g = globalThis as unknown as { __podHub?: Hub };

function hub(): Hub {
  if (!g.__podHub) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    g.__podHub = {
      clientId: randomUUID(),
      emitter,
      state: {
        connected: false,
        runningPromptId: null,
        node: null,
        progress: null,
        queueRemaining: 0,
        previewSeq: 0,
        finished: {},
        errors: {},
      },
      preview: null,
      ws: null,
      retry: null,
    };
  }
  return g.__podHub;
}

const MAX_TRACKED = 1000;

function trim(obj: Record<string, unknown>) {
  const keys = Object.keys(obj);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TRACKED))) delete obj[k];
}

function changed(event: string, extra?: unknown) {
  const h = hub();
  h.emitter.emit("change", { event, extra });
}

function finish(promptId: string, result: "success" | "error" | "interrupted") {
  const s = hub().state;
  // execution_success/_error UND executing(null) melden dasselbe Ende → nur einmal
  if (s.finished[promptId]) return;
  s.finished[promptId] = result;
  trim(s.finished);
  if (s.runningPromptId === promptId) {
    s.runningPromptId = null;
    s.node = null;
    s.progress = null;
  }
  changed("finished", { promptId, result });
}

function handleJson(msg: { type: string; data: Record<string, unknown> }) {
  const s = hub().state;
  const d = msg.data ?? {};
  const pid = d.prompt_id as string | undefined;
  switch (msg.type) {
    case "status": {
      const info = (d.status as { exec_info?: { queue_remaining?: number } })?.exec_info;
      s.queueRemaining = info?.queue_remaining ?? s.queueRemaining;
      changed("status");
      break;
    }
    case "execution_start":
      s.runningPromptId = pid ?? null;
      s.node = null;
      s.progress = null;
      changed("start", { promptId: pid });
      break;
    case "executing":
      if (d.node === null || d.node === undefined) {
        if (pid) finish(pid, s.errors[pid] ? "error" : "success");
      } else {
        s.runningPromptId = pid ?? s.runningPromptId;
        s.node = String(d.node);
        s.progress = null;
        changed("executing");
      }
      break;
    case "progress":
      s.runningPromptId = pid ?? s.runningPromptId;
      s.progress = { value: Number(d.value), max: Number(d.max) };
      if (d.node) s.node = String(d.node);
      changed("progress");
      break;
    case "execution_success":
      if (pid) finish(pid, "success");
      break;
    case "execution_error":
      if (pid) {
        s.errors[pid] = {
          message: String(d.exception_message ?? "Unbekannter Fehler").trim(),
          nodeId: d.node_id ? String(d.node_id) : undefined,
          nodeType: d.node_type ? String(d.node_type) : undefined,
        };
        trim(s.errors);
        finish(pid, "error");
      }
      break;
    case "execution_interrupted":
      if (pid) finish(pid, "interrupted");
      break;
  }
}

function handleBinary(buf: Buffer) {
  if (buf.length < 8) return;
  const h = hub();
  const type = buf.readUInt32BE(0);
  let mime = "image/jpeg";
  let data: Buffer | null = null;
  if (type === 1) {
    mime = buf.readUInt32BE(4) === 2 ? "image/png" : "image/jpeg";
    data = buf.subarray(8);
  } else if (type === 4) {
    // PREVIEW_IMAGE_WITH_METADATA: [len][json][bild]
    const len = buf.readUInt32BE(4);
    try {
      const meta = JSON.parse(buf.subarray(8, 8 + len).toString("utf8"));
      mime = meta.image_type || mime;
    } catch {}
    data = buf.subarray(8 + len);
  }
  if (!data || !data.length) return;
  h.preview = { data: Buffer.from(data), mime };
  h.state.previewSeq++;
  changed("preview");
}

function connect() {
  const h = hub();
  if (h.ws) return;
  const url = config.comfyUrl.replace(/^http/, "ws") + `/ws?clientId=${h.clientId}`;
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.binaryType = "arraybuffer";
  h.ws = ws;
  ws.onopen = () => {
    h.state.connected = true;
    changed("connected");
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      try {
        handleJson(JSON.parse(ev.data));
      } catch {}
    } else if (ev.data instanceof ArrayBuffer) {
      handleBinary(Buffer.from(ev.data));
    }
  };
  ws.onclose = () => {
    h.ws = null;
    if (h.state.connected) {
      h.state.connected = false;
      changed("disconnected");
    }
    scheduleReconnect();
  };
  ws.onerror = () => {
    try {
      ws.close();
    } catch {}
  };
}

function scheduleReconnect() {
  const h = hub();
  if (h.retry) return;
  h.retry = setTimeout(() => {
    h.retry = null;
    connect();
  }, 3000);
}

/** Startet (einmalig) die WebSocket-Verbindung zu ComfyUI. */
export function ensureEvents() {
  connect();
  return hub();
}

export function getClientId() {
  return ensureEvents().clientId;
}

export function getLiveState(): LiveState {
  return ensureEvents().state;
}

export function getPreview() {
  return hub().preview;
}

export function onChange(fn: (e: { event: string; extra?: unknown }) => void) {
  const h = ensureEvents();
  h.emitter.on("change", fn);
  return () => h.emitter.off("change", fn);
}
