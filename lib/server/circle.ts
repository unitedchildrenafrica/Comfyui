import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type CircleRow, type CircleStore, type ManualMember, type Tri, buildRows, carriesStart, migrateAcks } from "../circle";
import type { PatreonTier } from "../patreon";
import { config } from "./config";
import { getAcks, getSnapshot, getTrackedTiers, patreonConfigured, patreonError } from "./patreon";

// Inner Circle: was der Nutzer zu Mitgliedern festhält (Discord, Bot, Notiz, Hand-Mitglieder und pro
// Zahlung angeschrieben/Antwort/Set/hat es). Patreon-Daten selbst kommen aus patreon-members.json.

const FILE = () => config.dataPath("inner-circle.json");

export class CircleError extends Error {}

export interface CircleView {
  configured: boolean;
  syncedAt: number | null;
  error: string | null;
  tiers: PatreonTier[];
  trackedTiers: string[] | null;
  rows: CircleRow[];
}

/** Nur „Datei gibt es noch nicht“ heißt leer. Kaputt oder nicht lesbar → Fehler, damit nie ein leerer Stand die Daten überschreibt. */
export async function getStore(): Promise<CircleStore> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { people: {}, cycles: {} };
    throw err;
  }
  let s: Partial<CircleStore>;
  try {
    s = JSON.parse(raw) as Partial<CircleStore>;
  } catch {
    throw new Error("inner-circle.json ist beschädigt – bitte nicht weiter ändern und die Datei prüfen (es wurde nichts überschrieben)");
  }
  return { people: s.people ?? {}, cycles: s.cycles ?? {}, ...(s.acksMigrated ? { acksMigrated: true } : {}) };
}

let queue: Promise<unknown> = Promise.resolve();

/** Ändern in einer Warteschlange: jede Änderung liest den neuesten Stand – nichts wird überschrieben. Wirft fn, wird nichts gespeichert. */
export function updateStore(fn: (s: CircleStore) => void): Promise<CircleStore> {
  const run = async () => {
    const s = await getStore();
    fn(s);
    await fs.mkdir(path.dirname(FILE()), { recursive: true });
    const tmp = `${FILE()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(s, null, 1), { mode: 0o600 });
    await fs.rename(tmp, FILE());
    return s;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

export async function circleView(): Promise<CircleView> {
  const snap = await getSnapshot();
  let store = await getStore();
  if (!store.acksMigrated) {
    const acks = await getAcks();
    store = await updateStore((s) => Object.assign(s, migrateAcks(s, acks)));
  }
  const tracked = await getTrackedTiers(snap);
  return {
    configured: patreonConfigured(),
    syncedAt: snap?.syncedAt ?? null,
    error: patreonError(),
    tiers: snap?.tiers ?? [],
    trackedTiers: tracked,
    rows: buildRows(snap, tracked, store),
  };
}

// --- Prüfen --------------------------------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function assertKnown(key: string, s: CircleStore) {
  if (s.people[key]?.manual) return;
  const snap = await getSnapshot();
  if (!snap?.members.some((m) => m.id === key)) throw new CircleError("Unbekanntes Mitglied");
}

function text(v: unknown, max: number, label: string): string {
  if (typeof v !== "string") throw new CircleError(`${label}: Text erwartet`);
  const t = v.trim();
  if (t.length > max) throw new CircleError(`${label}: höchstens ${max} Zeichen`);
  return t;
}

function day(v: unknown, label: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !DAY.test(v) || Number.isNaN(Date.parse(v))) throw new CircleError(`${label}: Datum JJJJ-MM-TT erwartet`);
  return v;
}

function manual(m: Partial<ManualMember>, base?: ManualMember): ManualMember {
  const out: ManualMember = { ...(base ?? { name: "" }) };
  if (m.name !== undefined || !base) {
    out.name = text(m.name ?? "", 80, "Name");
    if (!out.name) throw new CircleError("Name fehlt");
  }
  if (m.tier !== undefined) out.tier = text(m.tier, 60, "Stufe");
  if (m.email !== undefined) out.email = text(m.email, 200, "E-Mail");
  if (m.cents !== undefined) {
    if (!Number.isInteger(m.cents) || m.cents < 0 || m.cents > 10_000_000) throw new CircleError("Betrag ungültig");
    out.cents = m.cents;
  }
  if (m.yearly !== undefined) out.yearly = !!m.yearly;
  if (m.ended !== undefined) out.ended = !!m.ended;
  if (m.since !== undefined) out.since = day(m.since, "Beitritt");
  if (m.lastCharge !== undefined) out.lastCharge = day(m.lastCharge, "Letzte Zahlung");
  if (m.nextCharge !== undefined) out.nextCharge = day(m.nextCharge, "Nächste Zahlung");
  return out;
}

/** „2026-01-31“ + 1 Monat → „2026-02-28“ (Monatsende bleibt gültig) */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

// --- Ändern --------------------------------------------------------------------------------

export async function setCycleField(key: string, cycleId: string, field: "contacted" | "answer" | "hasIt" | "set", value: Tri | string | null): Promise<void> {
  if (cycleId !== "start" && !DAY.test(cycleId)) throw new CircleError("Ungültiger Monat");
  let clean: string | undefined;
  if (field === "set") clean = value === null ? undefined : text(value, 200, "Set") || undefined;
  else if (value === null) clean = undefined;
  else if (value === "yes" || value === "no") clean = value;
  else throw new CircleError("Wert muss Ja, Nein oder leer sein");
  if (!["contacted", "answer", "hasIt", "set"].includes(field)) throw new CircleError("Unbekanntes Feld");
  const s0 = await getStore();
  await assertKnown(key, s0);
  await updateStore((s) => {
    const own = (s.cycles[key] ??= {});
    // erster Zahlungsmonat: Werte aus „start“ hinüberschieben (nicht kopieren – sonst doppelt im Verlauf)
    if (carriesStart(own, cycleId)) {
      own[cycleId] = own.start;
      delete own.start;
    }
    const c = (own[cycleId] ??= { updatedAt: 0 });
    if (clean === undefined) delete c[field];
    else (c as unknown as Record<string, unknown>)[field] = clean;
    if (field === "answer") {
      if (clean === "yes") c.answerAt = Date.now();
      else delete c.answerAt;
    }
    c.updatedAt = Date.now();
  });
}

const PERSON_MAX: Record<string, number> = { discord: 100, bot: 100, note: 2000 };

export async function setPersonField(key: string, field: "discord" | "bot" | "note", value: string): Promise<void> {
  // nur eigene Schlüssel – „constructor“ usw. aus dem Prototyp zählen nicht
  if (!Object.hasOwn(PERSON_MAX, field)) throw new CircleError("Unbekanntes Feld");
  const max = PERSON_MAX[field];
  const clean = text(value, max, field === "note" ? "Notiz" : field === "bot" ? "Bot" : "Discord");
  await assertKnown(key, await getStore());
  await updateStore((s) => {
    const p = (s.people[key] ??= {});
    if (clean) p[field] = clean;
    else delete p[field];
  });
}

export async function addManual(m: Partial<ManualMember>): Promise<string> {
  const clean = manual(m);
  const key = `m_${randomBytes(9).toString("base64url").replace(/[^A-Za-z0-9]/g, "x").slice(0, 12)}`;
  await updateStore((s) => {
    s.people[key] = { manual: clean };
  });
  return key;
}

function manualOf(s: CircleStore, key: string): ManualMember {
  const m = s.people[key]?.manual;
  if (!m) throw new CircleError("Unbekanntes Mitglied");
  return m;
}

export async function editManual(key: string, patch: Partial<ManualMember>): Promise<void> {
  await updateStore((s) => {
    const base = manualOf(s, key);
    s.people[key].manual = manual(patch, base);
  });
}

export async function removeManual(key: string): Promise<void> {
  await updateStore((s) => {
    manualOf(s, key);
    delete s.people[key];
    delete s.cycles[key];
  });
}

/** „Zahlung erhalten“: letzte Zahlung = heute, nächste = + 1 Monat (jährlich + 12) – neuer Zyklus */
export async function paidManual(key: string, today: string): Promise<void> {
  const d = day(today, "Datum");
  if (!d) throw new CircleError("Datum fehlt");
  await updateStore((s) => {
    const m = manualOf(s, key);
    m.lastCharge = d;
    m.nextCharge = addMonths(d, m.yearly ? 12 : 1);
  });
}
