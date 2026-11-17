// Knete-Stil (vorübergehender Bereich): Fotos per OpenAI-Bildbearbeitung im Stil eigener
// Referenzbilder neu erzeugen. Läuft komplett über die OpenAI-API, nicht über ComfyUI/den Pod.
// Diese Datei enthält nur reine Funktionen und Typen (Browser + Server).

export const KNETE_MODELS = [
  { value: "gpt-image-2.6-sunburst", label: "GPT Image 2.6 – beste Qualität (neuestes)" },
  { value: "gpt-image-2.6-flare", label: "GPT Image 2.6 Flare – schneller" },
  { value: "gpt-image-2.5-sunburst", label: "GPT Image 2.5" },
  { value: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare – schneller" },
] as const;

export const KNETE_QUALITIES = ["low", "medium", "high"] as const;
export type KneteQuality = (typeof KNETE_QUALITIES)[number];

/** Längste Seite des Ergebnisses: wie das Foto (Seitenverhältnis bleibt) oder „auto“ (OpenAI entscheidet). */
export const KNETE_SIZES = ["1536", "2048", "auto"] as const;
export type KneteSize = (typeof KNETE_SIZES)[number];

export const KNETE_MAX_REFS = 10;
export const KNETE_MAX_PHOTOS = 500;

export const DEFAULT_KNETE_PROMPT = `Image 1 is a photo. All following images are style references that show a handmade clay / plasticine (claymation) look.

Recreate image 1 exactly 1:1 in this clay style. Keep the identical composition, framing, crop, camera angle and perspective. Keep the same people with the same faces, hair, poses, gestures and expressions, the same clothing, objects, background and color palette. Every element of the photo stays in the same place with the same proportions.

Only change the material and rendering: everything looks sculpted from plasticine exactly like in the reference images – same clay texture, surface finish, fingerprints and tool marks, lighting and level of detail as the references.

Do not add, remove or move anything. Do not take any people, objects or backgrounds from the reference images – use them only for the style.`;

export interface KneteSettings {
  model: string;
  quality: KneteQuality;
  size: KneteSize;
  prompt: string;
  /** Wie viele Bilder gleichzeitig bei OpenAI angefragt werden */
  concurrency: number;
}

export const DEFAULT_KNETE_SETTINGS: KneteSettings = {
  model: KNETE_MODELS[0].value,
  quality: "high",
  size: "1536",
  prompt: DEFAULT_KNETE_PROMPT,
  concurrency: 3,
};

export function normalizeKneteSettings(raw: Partial<KneteSettings> | null | undefined): KneteSettings {
  const s = { ...DEFAULT_KNETE_SETTINGS, ...(raw ?? {}) };
  return {
    model: typeof s.model === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(s.model) ? s.model : DEFAULT_KNETE_SETTINGS.model,
    quality: (KNETE_QUALITIES as readonly string[]).includes(s.quality) ? s.quality : DEFAULT_KNETE_SETTINGS.quality,
    size: (KNETE_SIZES as readonly string[]).includes(s.size) ? s.size : DEFAULT_KNETE_SETTINGS.size,
    prompt: typeof s.prompt === "string" && s.prompt.trim() ? s.prompt.slice(0, 30_000) : DEFAULT_KNETE_PROMPT,
    concurrency: Math.min(6, Math.max(1, Math.round(Number(s.concurrency) || DEFAULT_KNETE_SETTINGS.concurrency))),
  };
}

export type KneteItemStatus = "pending" | "running" | "done" | "error" | "cancelled";

export interface KneteItem {
  i: number;
  /** Originaler Dateiname (zur Anzeige) */
  name: string;
  /** Eingabedatei im Auftragsordner (in/…) */
  input: string;
  width: number;
  height: number;
  /** Ergebnisdatei im Ausgabeordner knete/<folder>/ */
  output?: string;
  status: KneteItemStatus;
  error?: string;
  costUsd?: number;
  ms?: number;
  updatedAt: number;
}

export interface KneteJob {
  id: string;
  /** Ordner unter OUTPUT_DIR/knete/ */
  folder: string;
  createdAt: number;
  settings: KneteSettings;
  /** Kopien der Referenzbilder im Auftragsordner (refs/…) */
  refs: string[];
  items: KneteItem[];
  /** Grund, warum der Auftrag angehalten ist (z. B. Guthaben leer). Fortsetzen löscht ihn. */
  paused?: string;
}

export interface KneteJobSummary {
  id: string;
  folder: string;
  createdAt: number;
  total: number;
  done: number;
  errors: number;
  running: number;
  pending: number;
  cancelled: number;
  costUsd: number;
  paused?: string;
}

export function summarize(job: KneteJob): KneteJobSummary {
  const count = (s: KneteItemStatus) => job.items.filter((x) => x.status === s).length;
  return {
    id: job.id,
    folder: job.folder,
    createdAt: job.createdAt,
    total: job.items.length,
    done: count("done"),
    errors: count("error"),
    running: count("running"),
    pending: count("pending"),
    cancelled: count("cancelled"),
    costUsd: job.items.reduce((s, x) => s + (x.costUsd ?? 0), 0),
    paused: job.paused,
  };
}

/**
 * Ausgabegröße für die OpenAI-Bildbearbeitung: Seitenverhältnis des Fotos, längste Seite = target,
 * beide Seiten durch 16 teilbar, Verhältnis zwischen 1:3 und 3:1 (Vorgabe der 2.5/2.6-Modelle).
 */
export function outputSize(width: number, height: number, size: KneteSize): string {
  if (size === "auto" || !(width > 0) || !(height > 0)) return "auto";
  const target = Number(size);
  const ratio = Math.min(3, Math.max(1 / 3, width / height));
  const r16 = (v: number) => Math.max(16, Math.round(v / 16) * 16);
  return ratio >= 1 ? `${target}x${r16(target / ratio)}` : `${r16(target * ratio)}x${target}`;
}

/** Preise laut OpenAI-Preisliste (Standard, pro 1 Mio. Tokens) für die GPT-Image-2.x-Familie. */
export const KNETE_PRICES = { imageInput: 8, textInput: 5, imageOutput: 30 };

export interface OpenAIImageUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { image_tokens?: number; text_tokens?: number };
}

export function costFromUsage(u: OpenAIImageUsage | null | undefined): number | undefined {
  if (!u) return undefined;
  const img = u.input_tokens_details?.image_tokens ?? 0;
  const txt = u.input_tokens_details?.text_tokens ?? Math.max(0, (u.input_tokens ?? 0) - img);
  const out = u.output_tokens ?? 0;
  return (img * KNETE_PRICES.imageInput + txt * KNETE_PRICES.textInput + out * KNETE_PRICES.imageOutput) / 1e6;
}

/** Dateiname ohne Endung, nur sichere Zeichen (für Ausgabedateien). */
export function safeBase(name: string): string {
  const base = name.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return (base || "bild").slice(0, 60);
}

/** Ordnername unter knete/ (Standard: Datum und Uhrzeit). */
export function safeFolder(name: string | undefined, now = new Date()): string {
  const cleaned = (name ?? "").trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  if (cleaned) return cleaned;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
}

/** Lesbare Fehlermeldung aus einer OpenAI-Fehlerantwort. */
export function describeOpenAIError(status: number, body: { error?: { message?: string; code?: string | null; type?: string } } | null): string {
  const e = body?.error;
  const code = e?.code ?? "";
  const msg = e?.message ?? "";
  if (code === "moderation_blocked" || /safety system|moderation/i.test(msg)) return "Von OpenAI abgelehnt (Inhaltsfilter)";
  if (status === 401) return "OpenAI-Schlüssel ungültig";
  if (code === "insufficient_quota" || code === "billing_hard_limit_reached") return "OpenAI-Guthaben aufgebraucht";
  if (status === 429) return "Zu viele Anfragen (Rate-Limit)";
  return msg ? `OpenAI (${status}): ${msg}` : `OpenAI antwortet mit HTTP ${status}`;
}

/** Fehler, bei denen der ganze Auftrag anhalten soll statt Bild für Bild weiter zu scheitern. */
export function isFatalOpenAIError(status: number, body: { error?: { code?: string | null } } | null): boolean {
  const code = body?.error?.code ?? "";
  return status === 401 || status === 403 || code === "insufficient_quota" || code === "billing_hard_limit_reached" || code === "model_not_found";
}

/** Vorübergehende Fehler, die automatisch wiederholt werden. */
export function isRetryableStatus(status: number, body: { error?: { code?: string | null } } | null): boolean {
  if (isFatalOpenAIError(status, body)) return false;
  return status === 429 || status === 408 || status >= 500;
}
