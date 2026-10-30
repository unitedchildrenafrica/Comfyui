// Notizen für Patreon-Arbeit: Typen und reine Hilfsfunktionen (Client + Server).

import type { ImageGenerator } from "./types";

interface Base {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export type OrderStatus = "open" | "progress" | "tosend" | "sent";

export const ORDER_STATUS: { value: OrderStatus; label: string; short: string }[] = [
  { value: "open", label: "Offen", short: "Offen" },
  { value: "progress", label: "In Arbeit", short: "In Arbeit" },
  { value: "tosend", label: "Fertig – noch zu schicken", short: "Zu schicken" },
  { value: "sent", label: "Verschickt", short: "Verschickt" },
];

/** Custom-Auftrag: für wen, welcher Charakter, Bild oder Video. */
export interface Order extends Base {
  person: string;
  character: string;
  kind: "image" | "video";
  status: OrderStatus;
  /** YYYY-MM-DD oder leer */
  deadline: string;
  paid: boolean;
  note: string;
  sentAt?: number;
}

export type PostStatus = "unreleased" | "planned" | "posted";

export const POST_STATUS: { value: PostStatus; label: string }[] = [
  { value: "unreleased", label: "Unreleased" },
  { value: "planned", label: "Zu posten" },
  { value: "posted", label: "Gepostet" },
];

export interface Post extends Base {
  title: string;
  kind: "image" | "video";
  status: PostStatus;
  /** Free, Tier 1 … frei wählbar */
  tier: string;
  /** geplantes Datum YYYY-MM-DD oder leer */
  date: string;
  /** Post-Text zum Vorschreiben */
  text: string;
  postedAt?: number;
}

export type IdeaStatus = "idea" | "planned" | "done";

export const IDEA_STATUS: { value: IdeaStatus; label: string }[] = [
  { value: "idea", label: "Idee" },
  { value: "planned", label: "Geplant" },
  { value: "done", label: "Erledigt" },
];

/** Charakter-Idee oder Wunsch eines Patrons */
export interface Idea extends Base {
  title: string;
  /** Wer es sich gewünscht hat (leer = eigene Idee) */
  from: string;
  /** Stimmen/Wünsche – hochzählbar */
  votes: number;
  status: IdeaStatus;
  note: string;
}

export interface Snippet extends Base {
  title: string;
  body: string;
}

/** Monats-Checkliste: Haken gelten nur für den Monat, in dem sie gesetzt wurden. */
export interface ChecklistItem extends Base {
  text: string;
  /** Monate (YYYY-MM), in denen der Punkt erledigt wurde */
  doneIn: string[];
}

export interface CharacterLora {
  name: string;
  strength: number;
  /** Download-Link zum Neu-Laden, falls die Datei gelöscht wurde */
  url?: string;
}

/** Charakter-Bibliothek: Prompt + LoRAs + Modell, mit einem Tipp ins Bild-Formular. */
export interface Character extends Base {
  name: string;
  /** Serie / Spiel, frei */
  series: string;
  generator: ImageGenerator;
  /** leer = Modell im Formular nicht ändern */
  checkpoint: string;
  positive: string;
  negative: string;
  loras: CharacterLora[];
  note: string;
}

export interface Pad extends Base {
  text: string;
}

export interface NoteCollections {
  orders: Order;
  posts: Post;
  ideas: Idea;
  snippets: Snippet;
  checklist: ChecklistItem;
  characters: Character;
  pad: Pad;
}

export type CollectionName = keyof NoteCollections;

export const COLLECTIONS: CollectionName[] = ["orders", "posts", "ideas", "snippets", "checklist", "characters", "pad"];

export const isCollection = (v: string): v is CollectionName => (COLLECTIONS as string[]).includes(v);

export const PAD_ID = "main";

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Aktueller Monat als YYYY-MM (Ortszeit) */
export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_DE[m - 1] ?? key} ${y}`;
}

/** Datum YYYY-MM-DD → „Fr 31.10.“ */
export function shortDate(ymd: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const d = new Date(`${ymd}T12:00:00`);
  return `${["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getDay()]} ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}

/** Tage bis zum Datum (heute = 0, negativ = überfällig) */
export function daysUntil(ymd: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - today) / 86_400_000);
}

/** Texte eines Eintrags für die Suche */
export function searchText(col: CollectionName, item: NoteCollections[CollectionName]): string {
  const i = item as unknown as Record<string, unknown>;
  const parts: unknown[] = [];
  switch (col) {
    case "orders":
      parts.push(i.person, i.character, i.note);
      break;
    case "posts":
      parts.push(i.title, i.tier, i.text);
      break;
    case "ideas":
      parts.push(i.title, i.from, i.note);
      break;
    case "snippets":
      parts.push(i.title, i.body);
      break;
    case "checklist":
      parts.push(i.text);
      break;
    case "characters":
      parts.push(i.name, i.series, i.positive, i.note, ...((i.loras as CharacterLora[] | undefined) ?? []).map((l) => l.name));
      break;
    case "pad":
      parts.push(i.text);
      break;
  }
  return parts.filter((p) => typeof p === "string").join("\n").toLowerCase();
}

/** Alle Suchwörter müssen vorkommen (Groß/klein egal) */
export function matches(col: CollectionName, item: NoteCollections[CollectionName], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = searchText(col, item);
  return words.every((w) => text.includes(w));
}

/** Noch-zu-schicken-Aufträge nach Person gruppiert (Person alphabetisch, Groß/klein egal) */
export function groupToSend(orders: Order[]): { person: string; orders: Order[] }[] {
  const map = new Map<string, { person: string; orders: Order[] }>();
  for (const o of orders) {
    if (o.status !== "tosend") continue;
    const key = o.person.trim().toLowerCase() || "?";
    if (!map.has(key)) map.set(key, { person: o.person.trim() || "Ohne Name", orders: [] });
    map.get(key)!.orders.push(o);
  }
  return [...map.values()].sort((a, b) => a.person.localeCompare(b.person, "de"));
}

/** Dateiname ohne Unterordner („pony/abc.safetensors“ → „abc.safetensors“) */
export const baseName = (name: string) => name.split(/[\\/]/).pop() ?? name;

/** Passenden Eintrag in der Liste des Pods finden – auch wenn er in einem Unterordner liegt. */
export function findAvailable(name: string, available: string[]): string | null {
  if (available.includes(name)) return name;
  const b = baseName(name).toLowerCase();
  return available.find((a) => baseName(a).toLowerCase() === b) ?? null;
}

/** Token aus einem gespeicherten Link entfernen – Links landen in Dateien und in der Oberfläche. */
export function stripTokens(url: string): string {
  try {
    const u = new URL(url);
    for (const k of ["token", "access_token", "api_key", "apikey", "key"]) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}
