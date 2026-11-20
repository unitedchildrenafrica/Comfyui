import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { comfyJson } from "./comfy";
import { config } from "./config";
import { mirrorSoon, startMirrorLoop } from "./mirror";
import { getOnlinePods, getPod, onPodChange, podSecret, rememberPromptPod, serverMode, withPod } from "./podLink";

// Live-Verbindung zu ComfyUI (WebSocket) – im Server-Modus eine pro verbundenem Pod, damit Bild-
// und Video-Pod gleichzeitig Fortschritt und Vorschau liefern. Fertig/Fehler/Laufzeit gelten für
// alle Pods gemeinsam (nach prompt_id).

export interface JobError {
  message: string;
  nodeId?: string;
  nodeType?: string;
}

/** Was gerade auf einem Pod läuft */
export interface RunState {
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
}

export interface LiveState extends RunState {
  /** mindestens ein Pod live verbunden */
  connected: boolean;
  /** prompt_id → Laufzeit in ms, nur für Jobs seit App-Start */
  durations: Record<string, number>;
  /** prompt_id → Ergebnis, nur für Jobs seit App-Start */
  finished: Record<string, "success" | "error" | "interrupted">;
  errors: Record<string, JobError>;
  /** Letzter Grund, warum die Live-Verbindung nicht steht (null = alles gut) */
  linkError: string | null;
  /** laufende Jobs aller Pods (die Felder oben = der erste davon, für ältere Anzeigen) */
  runs: (RunState & { podId: string })[];
  /** Live-Verbindung je Pod */
  pods: { podId: string; connected: boolean; linkError: string | null }[];
}

interface PodHub {
  podId: string;
  ws: WebSocket | null;
  /** Ziel und Startzeit der aktuellen Verbindung – hängende oder veraltete werden ersetzt */
  wsUrl: string | null;
  wsStartedAt: number;
  /** Zähler: Ereignisse alter, verworfener Verbindungen werden ignoriert */
  wsGen: number;
  retry: ReturnType<typeof setTimeout> | null;
  connected: boolean;
  linkError: string | null;
  run: RunState;
  preview: { data: Buffer; mime: string } | null;
  doneNodes: Set<string>;
  /** KJ-Vorschau aktiv → normale Binär-Vorschau ignorieren (sonst überschreibt sie das MP4) */
  kjPreview: boolean;
  closed: boolean;
}

interface NodeName {
  class_type: string;
  title?: string;
}

interface Shared {
  clientId: string;
  emitter: EventEmitter;
  hubs: Map<string, PodHub>;
  /** prompt_id → Node-ID → Klasse/Titel (für den Namen des aktuellen Nodes) */
  promptNodes: Map<string, Record<string, NodeName>>;
  durations: Record<string, number>;
  finished: Record<string, "success" | "error" | "interrupted">;
  errors: Record<string, JobError>;
  /** fortlaufend über alle Pods – die Vorschau-URL ändert sich so bei jedem Bild */
  previewSeq: number;
  watching: boolean;
}

const LOCAL = "local";
const g = globalThis as unknown as { __podHubs?: Shared };

function shared(): Shared {
  if (!g.__podHubs) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    g.__podHubs = {
      clientId: randomUUID(),
      emitter,
      hubs: new Map(),
      promptNodes: new Map(),
      durations: {},
      finished: {},
      errors: {},
      previewSeq: 0,
      watching: false,
    };
  }
  return g.__podHubs;
}

const emptyRun = (): RunState => ({
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
});

const MAX_TRACKED = 1000;

function trim(obj: Record<string, unknown>) {
  const keys = Object.keys(obj);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TRACKED))) delete obj[k];
}

function changed(event: string, extra?: unknown) {
  shared().emitter.emit("change", { event, extra });
}

/** Im Kontext des Pods ausführen, zu dem die Verbindung gehört */
const onHubPod = <T>(h: PodHub, fn: () => T): T => (serverMode() ? withPod(h.podId, fn) : fn());

/** Merkt sich die Node-Namen eines Workflows, damit der Fortschritt „SamplerCustomAdvanced“ statt „1512:2591“ zeigt. */
export function registerPromptNodes(promptId: string, workflow: Record<string, { class_type?: string; _meta?: { title?: string } }>) {
  const sh = shared();
  const names: Record<string, NodeName> = {};
  for (const [id, n] of Object.entries(workflow)) names[id] = { class_type: n.class_type ?? "?", title: n._meta?.title };
  sh.promptNodes.set(promptId, names);
  // nicht unbegrenzt wachsen lassen
  while (sh.promptNodes.size > 600) sh.promptNodes.delete(sh.promptNodes.keys().next().value!);
}

/** Für Jobs aus der ComfyUI-Oberfläche: Workflow aus /queue holen. */
async function loadPromptNodes(h: PodHub, promptId: string) {
  if (shared().promptNodes.has(promptId)) return;
  try {
    const q = await onHubPod(h, () => comfyJson<{ queue_running: unknown[][] }>("/queue"));
    const entry = q.queue_running?.find((e) => e[1] === promptId);
    if (entry?.[2]) registerPromptNodes(promptId, entry[2] as Record<string, { class_type?: string }>);
  } catch {}
  updateNodeInfo(h);
  changed("executing");
}

function updateNodeInfo(h: PodHub) {
  const s = h.run;
  const names = s.runningPromptId ? shared().promptNodes.get(s.runningPromptId) : undefined;
  s.nodesTotal = names ? Object.keys(names).length : 0;
  s.nodesDone = Math.min(h.doneNodes.size, s.nodesTotal || h.doneNodes.size);
  const n = s.node && names ? names[s.node] : undefined;
  s.nodeClass = n?.class_type ?? null;
  s.nodeLabel = n ? n.title || n.class_type : s.node ? `Node ${s.node}` : null;
}

function finish(h: PodHub, promptId: string, result: "success" | "error" | "interrupted") {
  const sh = shared();
  const s = h.run;
  // execution_success/_error UND executing(null) melden dasselbe Ende → nur einmal
  if (sh.finished[promptId]) return;
  sh.finished[promptId] = result;
  trim(sh.finished);
  if (s.runningPromptId === promptId) {
    if (s.startedAt) {
      sh.durations[promptId] = Date.now() - s.startedAt;
      trim(sh.durations);
    }
    Object.assign(s, { runningPromptId: null, node: null, progress: null, startedAt: null, nodeLabel: null, nodeClass: null, nodesDone: 0, nodesTotal: 0 });
    h.doneNodes.clear();
  }
  if (result === "success") mirrorSoon(promptId, serverMode() ? h.podId : null);
  changed("finished", { promptId, result, durationMs: sh.durations[promptId] ?? null });
}

function markNodeDone(h: PodHub, id: string | null) {
  if (id) h.doneNodes.add(id);
}

function handleJson(h: PodHub, msg: { type: string; data: Record<string, unknown> }) {
  const sh = shared();
  const s = h.run;
  const d = msg.data ?? {};
  const pid = d.prompt_id as string | undefined;
  if (pid && serverMode()) rememberPromptPod(pid, h.podId);
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
      h.doneNodes.clear();
      // Vorschau des vorherigen Jobs nicht weiter anzeigen
      h.preview = null;
      h.kjPreview = false;
      s.previewMime = null;
      s.previewStep = null;
      updateNodeInfo(h);
      if (pid && !sh.promptNodes.has(pid)) loadPromptNodes(h, pid);
      changed("start", { promptId: pid });
      break;
    case "execution_cached":
      for (const id of (d.nodes as string[] | undefined) ?? []) markNodeDone(h, String(id));
      updateNodeInfo(h);
      changed("executing");
      break;
    case "executing":
      if (d.node === null || d.node === undefined) {
        if (pid) finish(h, pid, sh.errors[pid] ? "error" : "success");
      } else {
        s.runningPromptId = pid ?? s.runningPromptId;
        if (!s.startedAt) s.startedAt = Date.now();
        // der vorherige Node ist fertig, sobald der nächste startet
        if (s.node && s.node !== String(d.node)) markNodeDone(h, s.node);
        s.node = String(d.node);
        s.progress = null;
        updateNodeInfo(h);
        changed("executing");
      }
      break;
    case "executed":
      if (d.node) markNodeDone(h, String(d.node));
      updateNodeInfo(h);
      break;
    case "progress":
      s.runningPromptId = pid ?? s.runningPromptId;
      s.progress = { value: Number(d.value), max: Number(d.max) };
      if (d.node && String(d.node) !== s.node) {
        s.node = String(d.node);
        updateNodeInfo(h);
      }
      changed("progress");
      break;
    case "execution_success":
      if (pid) finish(h, pid, "success");
      break;
    case "execution_error":
      if (pid) {
        sh.errors[pid] = {
          message: String(d.exception_message ?? "Unbekannter Fehler").trim(),
          nodeId: d.node_id ? String(d.node_id) : undefined,
          nodeType: d.node_type ? String(d.node_type) : undefined,
        };
        trim(sh.errors);
        finish(h, pid, "error");
      }
      break;
    case "execution_interrupted":
      if (pid) finish(h, pid, "interrupted");
      break;
    case "kj_preview_override": {
      // KJNodes „Model Preview Override“ (bei H3 mit taeh3): schickt die Vorschau als JSON mit
      // Base64 – je nach Einstellung JPEG, animiertes WebP oder MP4 mit Ton (preview_frames > 1).
      // Die normale ComfyUI-Vorschau ist bei --preview-method none (Standard) aus.
      const image = d.image;
      if (typeof image !== "string" || !image) break;
      h.kjPreview = true;
      h.preview = { data: Buffer.from(image, "base64"), mime: typeof d.mime === "string" ? d.mime : "image/jpeg" };
      s.previewMime = h.preview.mime;
      s.previewStep = typeof d.step === "number" ? d.step : null;
      s.previewSeq = ++sh.previewSeq;
      changed("preview");
      break;
    }
  }
}

function handleBinary(h: PodHub, buf: Buffer) {
  if (buf.length < 8) return;
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
  h.run.previewMime = mime;
  h.run.previewStep = null;
  h.run.previewSeq = ++shared().previewSeq;
  changed("preview");
}

/** Aktuelle Verbindung verwerfen – ihre späten Ereignisse zählen nicht mehr. */
function dropSocket(h: PodHub, reason?: string) {
  const old = h.ws;
  h.wsGen++;
  h.ws = null;
  h.wsUrl = null;
  if (reason) h.linkError = reason;
  if (h.connected) {
    h.connected = false;
    changed("disconnected");
  }
  try {
    old?.close();
  } catch {}
}

function targetUrl(h: PodHub): string | null {
  const base = serverMode() ? getPod(h.podId)?.url : config.comfyUrl;
  if (!base) return null;
  // Das Gateway prüft das Geheimnis bei WebSockets über die URL
  const secret = serverMode() && podSecret() ? `&pod_secret=${encodeURIComponent(podSecret())}` : "";
  return base.replace(/\/$/, "").replace(/^http/, "ws") + `/ws?clientId=${shared().clientId}${secret}`;
}

/** Ziel ohne Geheimnis – für Fehlermeldungen */
const showUrl = (u: string) => u.replace(/[?&]pod_secret=[^&]*/, "").replace(/\?clientId=[^&]*/, "");

function connect(h: PodHub) {
  if (h.closed) return;
  const url = targetUrl(h);
  if (!url) {
    h.linkError = "Pod nicht mehr angemeldet";
    return;
  }
  if (h.ws) {
    if (h.wsUrl === url) return;
    dropSocket(h); // Adresse hat sich geändert
  }
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    h.linkError = `WebSocket nicht möglich: ${err instanceof Error ? err.message : String(err)}`;
    scheduleReconnect(h);
    return;
  }
  const gen = ++h.wsGen;
  ws.binaryType = "arraybuffer";
  h.ws = ws;
  h.wsUrl = url;
  h.wsStartedAt = Date.now();
  ws.onopen = () => {
    if (gen !== h.wsGen) return;
    h.connected = true;
    h.linkError = null;
    changed("connected");
  };
  ws.onmessage = (ev) => {
    if (gen !== h.wsGen) return;
    if (typeof ev.data === "string") {
      try {
        handleJson(h, JSON.parse(ev.data));
      } catch {}
    } else if (ev.data instanceof ArrayBuffer) {
      handleBinary(h, Buffer.from(ev.data));
    }
  };
  ws.onclose = (ev) => {
    if (gen !== h.wsGen) return;
    h.ws = null;
    h.wsUrl = null;
    if (!h.connected || ev.code !== 1000) h.linkError = `Verbindung zu ${showUrl(url)} getrennt (Code ${ev.code}${ev.reason ? `, ${ev.reason}` : ""})`;
    if (h.connected) {
      h.connected = false;
      changed("disconnected");
    }
    scheduleReconnect(h);
  };
  ws.onerror = (ev) => {
    if (gen !== h.wsGen) return;
    const msg = (ev as unknown as { message?: string; error?: Error }).message || (ev as unknown as { error?: Error }).error?.message;
    if (msg) h.linkError = `Fehler bei ${showUrl(url)}: ${msg}`;
    try {
      ws.close();
    } catch {}
  };
}

function scheduleReconnect(h: PodHub) {
  if (h.retry || h.closed) return;
  h.retry = setTimeout(() => {
    h.retry = null;
    connect(h);
  }, 3000);
}

function newHub(podId: string): PodHub {
  return {
    podId,
    ws: null,
    wsUrl: null,
    wsStartedAt: 0,
    wsGen: 0,
    retry: null,
    connected: false,
    linkError: null,
    run: emptyRun(),
    preview: null,
    doneNodes: new Set(),
    kjPreview: false,
    closed: false,
  };
}

function closeHub(h: PodHub) {
  h.closed = true;
  if (h.retry) clearTimeout(h.retry);
  h.retry = null;
  dropSocket(h);
  shared().hubs.delete(h.podId);
}

/** Verbindungen an die angemeldeten Pods anpassen: neue verbinden, verschwundene schließen. */
function sync() {
  const sh = shared();
  const wanted = serverMode() ? getOnlinePods().map((p) => p.id) : [LOCAL];
  for (const id of wanted) {
    let h = sh.hubs.get(id);
    if (!h) {
      h = newHub(id);
      sh.hubs.set(id, h);
      changed("pods");
    }
    if (!h.ws && !h.retry) connect(h);
  }
  for (const h of [...sh.hubs.values()]) if (!wanted.includes(h.podId)) closeHub(h);
}

function watch() {
  const sh = shared();
  if (sh.watching) return;
  sh.watching = true;
  // neuer Pod bzw. neue Tunnel-Adresse → sofort neu verbinden, nicht auf das Schließen warten
  onPodChange((podId) => {
    const h = sh.hubs.get(podId);
    if (h) {
      dropSocket(h, "Pod-Adresse geändert – verbinde neu …");
      if (h.retry) {
        clearTimeout(h.retry);
        h.retry = null;
      }
    }
    sync();
    if (h && !h.closed) connect(h);
  });
  // Wächter: hängende Verbindungsversuche ersetzen, neue/getrennte Pods übernehmen
  setInterval(() => {
    for (const h of sh.hubs.values()) if (h.ws && !h.connected && Date.now() - h.wsStartedAt > 20_000) dropSocket(h, "Verbindungsaufbau hing – neuer Versuch");
    sync();
  }, 10_000).unref?.();
}

/** Startet (einmalig) die WebSocket-Verbindungen zu ComfyUI. */
export function ensureEvents() {
  watch();
  sync();
  startMirrorLoop();
  return shared();
}

export function getClientId() {
  return ensureEvents().clientId;
}

export function getLiveState(): LiveState {
  const sh = ensureEvents();
  const hubs = [...sh.hubs.values()];
  const runs = hubs.filter((h) => h.run.runningPromptId).map((h) => ({ podId: h.podId, ...h.run }));
  const primary = runs[0] ?? (hubs[0] ? { ...hubs[0].run } : emptyRun());
  const { podId: _p, ...primaryRun } = primary as RunState & { podId?: string };
  const linkError = hubs.length ? (hubs.find((h) => !h.connected)?.linkError ?? null) : serverMode() ? "Kein Pod angemeldet" : null;
  return {
    ...primaryRun,
    queueRemaining: hubs.reduce((n, h) => n + h.run.queueRemaining, 0),
    connected: hubs.some((h) => h.connected),
    linkError: hubs.some((h) => h.connected) && hubs.every((h) => h.connected) ? null : linkError,
    durations: sh.durations,
    finished: sh.finished,
    errors: sh.errors,
    runs,
    pods: hubs.map((h) => ({ podId: h.podId, connected: h.connected, linkError: h.linkError })),
  };
}

/** Lauf eines bestimmten Jobs (auf welchem Pod auch immer) */
export function runFor(promptId: string): (RunState & { podId: string }) | null {
  for (const h of shared().hubs.values()) if (h.run.runningPromptId === promptId) return { podId: h.podId, ...h.run };
  return null;
}

/** Live-Vorschau eines Pods – ohne Angabe die neueste */
export function getPreview(podId?: string | null) {
  const hubs = [...shared().hubs.values()];
  if (podId) return shared().hubs.get(podId)?.preview ?? null;
  const latest = hubs.filter((h) => h.preview).sort((a, b) => b.run.previewSeq - a.run.previewSeq)[0];
  return latest?.preview ?? null;
}

export function onChange(fn: (e: { event: string; extra?: unknown }) => void) {
  const sh = ensureEvents();
  sh.emitter.on("change", fn);
  return () => sh.emitter.off("change", fn);
}
