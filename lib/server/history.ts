import { ComfyUnavailableError, comfyJson } from "./comfy";
import { forEachPod, getPod, promptPodId, rememberPromptPod, serverMode, withPod } from "./podLink";

export interface MediaFile {
  filename: string;
  subfolder: string;
  type: string;
  kind: "image" | "video" | "audio";
}

export interface HistoryEntry {
  promptId: string;
  /** "interrupted" = selbst gestoppt (ComfyUI führt das im Verlauf als error) */
  status: "success" | "error" | "interrupted" | "running" | "unknown";
  timestamp: number;
  files: MediaFile[];
  error?: string;
  /** Laufzeit von execution_start bis Ende (ms), falls ComfyUI Zeitstempel liefert */
  durationMs: number | null;
  /** Server-Modus: Pod, auf dem der Job lief */
  podId?: string;
}

type RawHistory = Record<
  string,
  {
    outputs?: Record<string, Record<string, unknown>>;
    status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
  }
>;

const VIDEO_EXT = /\.(mp4|webm|mov|mkv|gif|webp)$/i;
const AUDIO_EXT = /\.(wav|mp3|flac|ogg|m4a)$/i;

function kindOf(filename: string): MediaFile["kind"] {
  if (AUDIO_EXT.test(filename)) return "audio";
  if (/\.(mp4|webm|mov|mkv)$/i.test(filename)) return "video";
  return "image";
}

export function parseHistory(raw: RawHistory): HistoryEntry[] {
  return Object.entries(raw).map(([promptId, h]) => {
    const files: MediaFile[] = [];
    for (const out of Object.values(h.outputs ?? {})) {
      // Bilder unter "images", Videos je nach Node unter "gifs" oder "videos"
      for (const key of ["images", "gifs", "videos", "audio"]) {
        const list = out[key];
        if (!Array.isArray(list)) continue;
        for (const f of list as { filename?: string; subfolder?: string; type?: string }[]) {
          if (!f?.filename || f.type !== "output") continue;
          if (key !== "images" && !VIDEO_EXT.test(f.filename) && !AUDIO_EXT.test(f.filename)) continue;
          files.push({ filename: f.filename, subfolder: f.subfolder ?? "", type: f.type, kind: kindOf(f.filename) });
        }
      }
    }
    const messages = h.status?.messages ?? [];
    const start = messages.find((m) => m[0] === "execution_start")?.[1]?.timestamp;
    const end = messages.find((m) => ["execution_success", "execution_error", "execution_interrupted"].includes(m[0]))?.[1]?.timestamp;
    const errMsg = messages.find((m) => m[0] === "execution_error")?.[1];
    const statusStr = h.status?.status_str;
    return {
      promptId,
      status: messages.some((m) => m[0] === "execution_interrupted")
        ? "interrupted"
        : statusStr === "success"
          ? "success"
          : statusStr === "error"
            ? "error"
            : h.status?.completed
              ? "success"
              : "unknown",
      timestamp: typeof start === "number" ? start : 0,
      files,
      error: errMsg
        ? `${errMsg.node_type ? `${String(errMsg.node_type)} (Node ${String(errMsg.node_id ?? "?")}): ` : ""}${String(errMsg.exception_message ?? "Fehler").trim()}`
        : undefined,
      durationMs: typeof start === "number" && typeof end === "number" && end >= start ? end - start : null,
    };
  });
}

/** Verlauf nur des Pods im aktuellen Kontext (bzw. des einzigen ComfyUI) */
export async function podHistory(maxItems = 300): Promise<HistoryEntry[]> {
  const raw = await comfyJson<RawHistory>(`/history?max_items=${maxItems}`, { timeoutMs: 30_000 });
  return parseHistory(raw).sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Server-Modus: auf allen verbundenen Pods ausführen und zusammenführen. Fällt ein Pod aus, kommen
 * die anderen trotzdem; nur wenn keiner antwortet, gibt es einen Fehler.
 */
async function fromAllPods<T>(fn: (podId: string) => Promise<T[]>): Promise<T[]> {
  const results = await forEachPod((pod) => fn(pod.id));
  if (!results.length) throw new ComfyUnavailableError(undefined, "Kein Pod verbunden");
  const ok = results.filter((r) => r.error === undefined);
  if (!ok.length) throw results[0].error;
  return ok.flatMap((r) => r.value ?? []);
}

export async function getHistory(maxItems = 300): Promise<HistoryEntry[]> {
  if (!serverMode()) return podHistory(maxItems);
  const all = await fromAllPods(async (podId) => {
    const list = await podHistory(maxItems);
    for (const e of list) {
      e.podId = podId;
      rememberPromptPod(e.promptId, podId);
    }
    return list;
  });
  return all.sort((a, b) => b.timestamp - a.timestamp);
}

async function entryHere(promptId: string): Promise<HistoryEntry | null> {
  const raw = await comfyJson<RawHistory>(`/history/${encodeURIComponent(promptId)}`);
  return parseHistory(raw)[0] ?? null;
}

export async function getHistoryEntry(promptId: string): Promise<HistoryEntry | null> {
  if (!serverMode()) return entryHere(promptId);
  // Pod des Jobs zuerst fragen, sonst alle
  const known = getPod(promptPodId(promptId));
  if (known) {
    const e = await withPod(known.id, () => entryHere(promptId)).catch(() => null);
    if (e) return { ...e, podId: known.id };
  }
  const found = await fromAllPods(async (podId) => {
    const e = await entryHere(promptId);
    return e ? [{ ...e, podId }] : [];
  });
  if (found[0]) rememberPromptPod(promptId, found[0].podId);
  return found[0] ?? null;
}

export interface QueueItem {
  number: number;
  promptId: string;
  /** Server-Modus: Pod, in dessen Warteschlange der Job steht */
  podId?: string;
}

export interface QueueSnapshot {
  running: QueueItem[];
  pending: QueueItem[];
}

async function queueHere(podId?: string): Promise<QueueSnapshot> {
  const q = await comfyJson<{ queue_running: unknown[][]; queue_pending: unknown[][] }>("/queue");
  const map = (list: unknown[][]) =>
    list.map((e) => ({ number: Number(e[0]), promptId: String(e[1]), ...(podId ? { podId } : {}) })).sort((a, b) => a.number - b.number);
  return { running: map(q.queue_running ?? []), pending: map(q.queue_pending ?? []) };
}

export async function getQueue(): Promise<QueueSnapshot> {
  if (!serverMode()) return queueHere();
  const parts = await fromAllPods(async (podId) => {
    const q = await queueHere(podId);
    for (const e of [...q.running, ...q.pending]) rememberPromptPod(e.promptId, podId);
    return [q];
  });
  return {
    running: parts.flatMap((p) => p.running),
    pending: parts.flatMap((p) => p.pending),
  };
}
