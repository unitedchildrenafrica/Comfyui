import { promises as fs } from "node:fs";
import path from "node:path";
import { type CollectionName, type NoteCollections, PAD_ID, stripTokens } from "../notes";
import { config } from "./config";

// Notizen liegen als eine JSON-Datei pro Sammlung in DATA_DIR/notes. Änderungen gehen pro
// Eintrag (nicht ganze Listen), damit Handy und Mac gleichzeitig offen sein können.

type Item<C extends CollectionName> = NoteCollections[C];

const file = (col: CollectionName) => config.dataPath("notes", `${col}.json`);

async function read<C extends CollectionName>(col: C): Promise<Item<C>[]> {
  try {
    const list = JSON.parse(await fs.readFile(file(col), "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function write(col: CollectionName, list: unknown[]) {
  const f = file(col);
  await fs.mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 1));
  await fs.rename(tmp, f);
}

// Schreibzugriffe pro Sammlung nacheinander, sonst gehen gleichzeitige Änderungen verloren
const queues = new Map<CollectionName, Promise<unknown>>();
function serial<T>(col: CollectionName, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(col) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(col, next.catch(() => {}));
  return next;
}

export async function listNotes<C extends CollectionName>(col: C): Promise<Item<C>[]> {
  return read(col);
}

export class ConflictError extends Error {
  constructor(public current: unknown) {
    super("Wurde inzwischen woanders geändert");
  }
}

const MAX_ITEMS = 5000;
const MAX_ITEM_BYTES = 500_000;

/**
 * Eintrag anlegen oder ersetzen. `baseUpdatedAt` = Stand, auf dem die Änderung beruht:
 * Ist der gespeicherte Eintrag inzwischen neuer, gibt es einen Konflikt statt stillem Überschreiben.
 */
export function putNote<C extends CollectionName>(col: C, raw: unknown, opts: { baseUpdatedAt?: number; force?: boolean } = {}): Promise<Item<C>> {
  return serial(col, async () => {
    const item = normalize(col, raw);
    if (JSON.stringify(item).length > MAX_ITEM_BYTES) throw new Error("Eintrag ist zu groß");
    const list = await read(col);
    const idx = list.findIndex((x) => x.id === item.id);
    const existing = idx >= 0 ? list[idx] : null;
    if (existing && !opts.force && opts.baseUpdatedAt !== undefined && existing.updatedAt > opts.baseUpdatedAt) {
      throw new ConflictError(existing);
    }
    const saved = { ...item, createdAt: existing?.createdAt ?? item.createdAt ?? Date.now(), updatedAt: Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1) } as Item<C>;
    if (idx >= 0) list[idx] = saved;
    else {
      if (list.length >= MAX_ITEMS) throw new Error("Zu viele Einträge");
      list.push(saved);
    }
    await write(col, list);
    return saved;
  });
}

export function deleteNote(col: CollectionName, id: string): Promise<void> {
  return serial(col, async () => {
    const list = await read(col);
    const next = list.filter((x) => x.id !== id);
    if (next.length !== list.length) await write(col, next);
  });
}

/** Reihenfolge setzen (Liste von IDs, nicht genannte bleiben hinten) */
export function reorderNotes(col: CollectionName, ids: string[]): Promise<void> {
  return serial(col, async () => {
    const list = await read(col);
    const pos = new Map(ids.map((id, i) => [id, i]));
    const sorted = [...list].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
    await write(col, sorted);
  });
}

// --- Eingaben prüfen -----------------------------------------------------------------

const str = (v: unknown, max = 100_000) => (typeof v === "string" ? v.slice(0, max) : "");
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

function normalize<C extends CollectionName>(col: C, raw: unknown): Item<C> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = col === "pad" ? PAD_ID : str(r.id, 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("Ungültige ID");
  const base = { id, createdAt: num(r.createdAt, Date.now()), updatedAt: num(r.updatedAt) };
  const kind = oneOf(r.kind, ["image", "video"] as const, "image");
  const out: Record<CollectionName, () => unknown> = {
    orders: () => ({
      ...base,
      person: str(r.person, 200),
      character: str(r.character, 300),
      kind,
      status: oneOf(r.status, ["open", "progress", "tosend", "sent"] as const, "open"),
      deadline: ymd(r.deadline),
      paid: r.paid === true,
      note: str(r.note, 20_000),
      ...(typeof r.sentAt === "number" ? { sentAt: r.sentAt } : {}),
    }),
    posts: () => ({
      ...base,
      title: str(r.title, 300),
      kind,
      status: oneOf(r.status, ["unreleased", "planned", "posted"] as const, "unreleased"),
      tier: str(r.tier, 100),
      date: ymd(r.date),
      text: str(r.text, 50_000),
      ...(typeof r.postedAt === "number" ? { postedAt: r.postedAt } : {}),
    }),
    ideas: () => ({
      ...base,
      title: str(r.title, 300),
      from: str(r.from, 300),
      votes: Math.max(0, Math.round(num(r.votes))),
      status: oneOf(r.status, ["idea", "planned", "done"] as const, "idea"),
      note: str(r.note, 20_000),
    }),
    snippets: () => ({ ...base, title: str(r.title, 300), body: str(r.body, 100_000) }),
    checklist: () => ({
      ...base,
      text: str(r.text, 1000),
      doneIn: Array.isArray(r.doneIn) ? [...new Set(r.doneIn.filter((m): m is string => typeof m === "string" && /^\d{4}-\d{2}$/.test(m)))].slice(-36) : [],
    }),
    characters: () => ({
      ...base,
      name: str(r.name, 300),
      series: str(r.series, 300),
      generator: oneOf(r.generator, ["wai", "pony", "anima"] as const, "wai"),
      checkpoint: str(r.checkpoint, 500),
      positive: str(r.positive, 50_000),
      negative: str(r.negative, 50_000),
      loras: (Array.isArray(r.loras) ? r.loras : []).slice(0, 30).map((l: Record<string, unknown>) => {
        const url = str(l?.url, 2000).trim();
        return { name: str(l?.name, 500), strength: Math.min(2, Math.max(-2, num(l?.strength, 1))), ...(url ? { url: stripTokens(url) } : {}) };
      }).filter((l) => l.name),
      note: str(r.note, 20_000),
    }),
    pad: () => ({ ...base, text: str(r.text, 2_000_000) }),
  };
  return out[col]() as Item<C>;
}
