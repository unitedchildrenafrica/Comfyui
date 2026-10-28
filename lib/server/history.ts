import { comfyJson } from "./comfy";

export interface MediaFile {
  filename: string;
  subfolder: string;
  type: string;
  kind: "image" | "video" | "audio";
}

export interface HistoryEntry {
  promptId: string;
  status: "success" | "error" | "running" | "unknown";
  timestamp: number;
  files: MediaFile[];
  error?: string;
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
    const errMsg = messages.find((m) => m[0] === "execution_error")?.[1];
    const statusStr = h.status?.status_str;
    return {
      promptId,
      status: statusStr === "success" ? "success" : statusStr === "error" ? "error" : h.status?.completed ? "success" : "unknown",
      timestamp: typeof start === "number" ? start : 0,
      files,
      error: errMsg ? String(errMsg.exception_message ?? "Fehler") : undefined,
    };
  });
}

export async function getHistory(maxItems = 300): Promise<HistoryEntry[]> {
  const raw = await comfyJson<RawHistory>(`/history?max_items=${maxItems}`, { timeoutMs: 30_000 });
  return parseHistory(raw).sort((a, b) => b.timestamp - a.timestamp);
}

export async function getHistoryEntry(promptId: string): Promise<HistoryEntry | null> {
  const raw = await comfyJson<RawHistory>(`/history/${encodeURIComponent(promptId)}`);
  return parseHistory(raw)[0] ?? null;
}

export interface QueueSnapshot {
  running: { number: number; promptId: string }[];
  pending: { number: number; promptId: string }[];
}

export async function getQueue(): Promise<QueueSnapshot> {
  const q = await comfyJson<{ queue_running: unknown[][]; queue_pending: unknown[][] }>("/queue");
  const map = (list: unknown[][]) =>
    list.map((e) => ({ number: Number(e[0]), promptId: String(e[1]) })).sort((a, b) => a.number - b.number);
  return { running: map(q.queue_running ?? []), pending: map(q.queue_pending ?? []) };
}
