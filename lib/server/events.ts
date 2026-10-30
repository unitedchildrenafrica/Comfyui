import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { comfyJson } from "./comfy";
import { config } from "./config";
import { mirrorSoon, startMirrorLoop } from "./mirror";
import { getPodLink, onPodChange, podSecret, serverMode } from "./podLink";

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
  /** MIME-Typ der letzten Vorschau: image/jpeg, image/png, image/webp oder video/mp4 (KJ, animiert mit Ton) */
  previewMime: string | null;
  /** Step, zu dem die Vorschau gehört (KJ-Vorschau) */
  previewStep: number | null;
  /** Start des laufenden Jobs (ms, Server-Uhr) */
  startedAt: number | null;
  /** Titel und Klasse des aktuellen Nodes, z. B. „SamplerCustomAdvanced“ */
  nodeLabel: string | null;
  nodeClass: string | null;
  /** fertige (inkl. gecachte) Nodes / alle Nodes des Jobs */
  nodesDone: number;
  nodesTotal: number;
  /** prompt_id → Laufzeit in ms, nur für Jobs seit App-Start */
  durations: Record<string, number>;
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
  /** prompt_id → Node-ID → Klasse/Titel (für den Namen des aktuellen Nodes) */
  promptNodes: Map<string, Record<string, NodeName>>;
  doneNodes: Set<string>;
  /** KJ-Vorschau aktiv → normale Binär-Vorschau ignorieren (sonst überschreibt sie das MP4) */
  kjPreview: boolean;
  podWatch?: boolean;
}

interface NodeName {
  class_type: string;
  title?: string;
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
        previewMime: null,
        previewStep: null,
        startedAt: null,
        nodeLabel: null,
        nodeClass: null,
        nodesDone: 0,
        nodesTotal: 0,
        durations: {},
        finished: {},
        errors: {},
      },
      preview: null,
      ws: null,
      retry: null,
      promptNodes: new Map(),
      doneNodes: new Set(),
      kjPreview: false,
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

/** Merkt sich die Node-Namen eines Workflows, damit der Fortschritt „SamplerCustomAdvanced“ statt „1512:2591“ zeigt. */
export function registerPromptNodes(promptId: string, workflow: Record<string, { class_type?: string; _meta?: { title?: string } }>) {
  const h = hub();
  const names: Record<string, NodeName> = {};
  for (const [id, n] of Object.entries(workflow)) names[id] = { class_type: n.class_type ?? "?", title: n._meta?.title };
  h.promptNodes.set(promptId, names);
  // nicht unbegrenzt wachsen lassen
  while (h.promptNodes.size > 600) h.promptNodes.delete(h.promptNodes.keys().next().value!);
}

/** Für Jobs aus der ComfyUI-Oberfläche: Workflow aus /queue holen. */
async function loadPromptNodes(promptId: string) {
  const h = hub();
  if (h.promptNodes.has(promptId)) return;
  try {
    const q = await comfyJson<{ queue_running: unknown[][] }>("/queue");
    const entry = q.queue_running?.find((e) => e[1] === promptId);
    if (entry?.[2]) registerPromptNodes(promptId, entry[2] as Record<string, { class_type?: string }>);
  } catch {}
  updateNodeInfo();
  changed("executing");
}

function updateNodeInfo() {
  const h = hub();
  const s = h.state;
  const names = s.runningPromptId ? h.promptNodes.get(s.runningPromptId) : undefined;
  s.nodesTotal = names ? Object.keys(names).length : 0;
  s.nodesDone = Math.min(h.doneNodes.size, s.nodesTotal || h.doneNodes.size);
  const n = s.node && names ? names[s.node] : undefined;
  s.nodeClass = n?.class_type ?? null;
  s.nodeLabel = n ? n.title || n.class_type : s.node ? `Node ${s.node}` : null;
}

function finish(promptId: string, result: "success" | "error" | "interrupted") {
  const h = hub();
  const s = h.state;
  // execution_success/_error UND executing(null) melden dasselbe Ende → nur einmal
  if (s.finished[promptId]) return;
  s.finished[promptId] = result;
  trim(s.finished);
  if (s.runningPromptId === promptId) {
    if (s.startedAt) {
      s.durations[promptId] = Date.now() - s.startedAt;
      trim(s.durations);
    }
    s.runningPromptId = null;
    s.node = null;
    s.progress = null;
    s.startedAt = null;
    s.nodeLabel = null;
    s.nodeClass = null;
    s.nodesDone = 0;
    s.nodesTotal = 0;
    h.doneNodes.clear();
  }
  if (result === "success") mirrorSoon(promptId);
  changed("finished", { promptId, result, durationMs: s.durations[promptId] ?? null });
}

function markNodeDone(id: string | null) {
  if (id) hub().doneNodes.add(id);
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
      s.startedAt = Date.now();
      hub().doneNodes.clear();
      // Vorschau des vorherigen Jobs nicht weiter anzeigen
      hub().preview = null;
      hub().kjPreview = false;
      s.previewMime = null;
      s.previewStep = null;
      updateNodeInfo();
      if (pid && !hub().promptNodes.has(pid)) loadPromptNodes(pid);
      changed("start", { promptId: pid });
      break;
    case "execution_cached":
      for (const id of (d.nodes as string[] | undefined) ?? []) markNodeDone(String(id));
      updateNodeInfo();
      changed("executing");
      break;
    case "executing":
      if (d.node === null || d.node === undefined) {
        if (pid) finish(pid, s.errors[pid] ? "error" : "success");
      } else {
        s.runningPromptId = pid ?? s.runningPromptId;
        if (!s.startedAt) s.startedAt = Date.now();
        // der vorherige Node ist fertig, sobald der nächste startet
        if (s.node && s.node !== String(d.node)) markNodeDone(s.node);
        s.node = String(d.node);
        s.progress = null;
        updateNodeInfo();
        changed("executing");
      }
      break;
    case "executed":
      if (d.node) markNodeDone(String(d.node));
      updateNodeInfo();
      break;
    case "progress":
      s.runningPromptId = pid ?? s.runningPromptId;
      s.progress = { value: Number(d.value), max: Number(d.max) };
      if (d.node && String(d.node) !== s.node) {
        s.node = String(d.node);
        updateNodeInfo();
      }
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
    case "kj_preview_override": {
      // KJNodes „Model Preview Override“ (bei H3 mit taeh3): schickt die Vorschau als JSON mit
      // Base64 – je nach Einstellung JPEG, animiertes WebP oder MP4 mit Ton (preview_frames > 1).
      // Die normale ComfyUI-Vorschau ist bei --preview-method none (Standard) aus.
      const image = d.image;
      if (typeof image !== "string" || !image) break;
      const h = hub();
      h.kjPreview = true;
      h.preview = { data: Buffer.from(image, "base64"), mime: typeof d.mime === "string" ? d.mime : "image/jpeg" };
      s.previewMime = h.preview.mime;
      s.previewStep = typeof d.step === "number" ? d.step : null;
      s.previewSeq++;
      changed("preview");
      break;
    }
  }
}

function handleBinary(buf: Buffer) {
  if (buf.length < 8) return;
  const h = hub();
  if (h.kjPreview) return;
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
  h.state.previewMime = mime;
  h.state.previewStep = null;
  h.state.previewSeq++;
  changed("preview");
}

function connect() {
  const h = hub();
  if (h.ws) return;
  if (!h.podWatch) {
    // neuer Pod angemeldet → WebSocket zur neuen Adresse aufbauen
    h.podWatch = true;
    onPodChange(() => {
      try {
        h.ws?.close();
      } catch {}
    });
  }
  if (serverMode() && !getPodLink()) {
    scheduleReconnect();
    return;
  }
  // Das Gateway prüft das Geheimnis bei WebSockets über die URL
  const secret = serverMode() && podSecret() ? `&pod_secret=${encodeURIComponent(podSecret())}` : "";
  const url = config.comfyUrl.replace(/^http/, "ws") + `/ws?clientId=${h.clientId}${secret}`;
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
  startMirrorLoop();
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
