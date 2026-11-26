// Inner Circle: Mitglieder-Tabelle. Reine Logik (Client + Server) – Zyklen pro Zahlung, Zustände,
// Filter, Kennzahlen, Tage bis zur Zahlung.

import { type PatreonMember, type PatreonTier, isPaid } from "./patreon";

export type Tri = "yes" | "no";

/** Antippen: offen → Ja → Nein → offen */
export function nextTri(v: Tri | undefined): Tri | undefined {
  return v === undefined ? "yes" : v === "yes" ? "no" : undefined;
}

/** Was pro Zahlung (Zyklus) festgehalten wird */
export interface CycleData {
  contacted?: Tri;
  answer?: Tri;
  hasIt?: Tri;
  set?: string;
  /** wann „Antwort ✓ Ja“ getippt wurde (ms) */
  answerAt?: number;
  updatedAt: number;
}

/** Mitglied ohne Patreon, von Hand gepflegt. cents = Betrag pro Monat */
export interface ManualMember {
  name: string;
  tier?: string;
  cents?: number;
  yearly?: boolean;
  since?: string | null;
  lastCharge?: string | null;
  nextCharge?: string | null;
  email?: string;
  ended?: boolean;
}

export interface PersonExtra {
  discord?: string;
  bot?: string;
  note?: string;
  manual?: ManualMember;
}

export interface CircleStore {
  /** Schlüssel: Patreon-Member-ID oder „m_…“ für Hand-Mitglieder */
  people: Record<string, PersonExtra>;
  /** Schlüssel → Zyklus-ID → Werte */
  cycles: Record<string, Record<string, CycleData>>;
  acksMigrated?: boolean;
}

/**
 * - former:   kein Mitglied mehr (bzw. Hand-Mitglied „beendet“)
 * - declined: Zahlung abgelehnt
 * - waiting:  aktiv, aber letzte Abbuchung nicht bezahlt (ausstehend, erstattet …) oder noch keine
 * - contact:  bezahlt, in diesem Zyklus noch nicht angeschrieben
 * - active:   bezahlt und angeschrieben
 */
export type RowState = "former" | "declined" | "contact" | "waiting" | "active";

export interface CircleRow {
  key: string;
  source: "patreon" | "manual";
  name: string;
  email: string;
  url: string | null;
  tier: string;
  cents: number;
  monthlyCents: number;
  yearly: boolean;
  since: string | null;
  lastCharge: string | null;
  lastChargeStatus: string | null;
  nextCharge: string | null;
  state: RowState;
  cycleId: string;
  cycle: CycleData;
  history: { cycleId: string; data: CycleData }[];
  discord: string;
  /** Discord-Name kam automatisch (Patreon-Verbindung + Discord-Bot), nicht selbst eingetragen */
  discordAuto: boolean;
  /** Mitglied hat Discord bei Patreon verbunden (Patreon liefert die ID) */
  discordLinked: boolean;
  bot: string;
  note: string;
  manual: ManualMember | null;
}

const DATED = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Zyklus = Datum der letzten bezahlten Abbuchung. Sonst (abgelehnt, ausstehend …) der jüngste schon
 * gespeicherte Zyklus bis zu dieser Abbuchung, sonst „start“.
 */
export function cycleIdFor(lastCharge: string | null, lastChargeStatus: string | null, storedIds: string[]): string {
  const day = lastCharge ? lastCharge.slice(0, 10) : null;
  if (day && DATED.test(day) && isPaid(lastChargeStatus)) return day;
  const dated = storedIds.filter((id) => DATED.test(id) && (!day || id <= day)).sort();
  return dated.at(-1) ?? "start";
}

/** Gibt es schon einen datierten Zyklus (also eine erste Zahlung mit Einträgen)? */
export const hasDatedCycle = (own: Record<string, CycleData>) => Object.keys(own).some((id) => DATED.test(id));

/**
 * Die Werte aus „start“ (vor der ersten Zahlung getippt) gelten nur für den ERSTEN Zahlungsmonat –
 * solange es noch keinen datierten Zyklus gibt. Spätere Zahlungen beginnen immer offen.
 */
export function carriesStart(own: Record<string, CycleData>, cycleId: string): boolean {
  return cycleId !== "start" && !own[cycleId] && !!own.start && !hasDatedCycle(own);
}

export function currentCycle(store: CircleStore, key: string, cycleId: string): CycleData {
  const own = store.cycles[key] ?? {};
  return own[cycleId] ?? (carriesStart(own, cycleId) ? own.start : undefined) ?? { updatedAt: 0 };
}

const hasValues = (c: CycleData) => !!(c.contacted || c.answer || c.hasIt || c.set?.trim());

function history(store: CircleStore, key: string, cycleId: string): CircleRow["history"] {
  const own = store.cycles[key] ?? {};
  const fromStart = carriesStart(own, cycleId);
  return Object.entries(own)
    .filter(([id, data]) => id !== cycleId && !(fromStart && id === "start") && hasValues(data))
    .sort(([a], [b]) => (a === "start" ? 1 : b === "start" ? -1 : b.localeCompare(a)))
    .map(([id, data]) => ({ cycleId: id, data }));
}

function paidState(cycle: CycleData, paid: boolean): RowState {
  if (!paid) return "waiting";
  return cycle.contacted === "yes" ? "active" : "contact";
}

export function buildRows(
  snap: { tiers: PatreonTier[]; members: PatreonMember[] } | null,
  tracked: string[] | null,
  store: CircleStore,
  /** Discord-ID → Benutzername (automatisch geholt) */
  discordNames: Record<string, string> = {},
): CircleRow[] {
  const rows: CircleRow[] = [];
  const trackedSet = tracked ? new Set(tracked) : null;
  const tierName = new Map((snap?.tiers ?? []).map((t) => [t.id, t.title]));

  for (const m of snap?.members ?? []) {
    if (trackedSet && !m.tierIds.some((t) => trackedSet.has(t))) continue;
    const extra = store.people[m.id] ?? {};
    const cycleId = cycleIdFor(m.lastCharge, m.lastChargeStatus, Object.keys(store.cycles[m.id] ?? {}));
    const cycle = currentCycle(store, m.id, cycleId);
    const declined = m.status === "declined_patron" || (m.lastChargeStatus ?? "").toLowerCase() === "declined";
    const state: RowState =
      m.status === "former_patron" || !m.status ? "former" : declined ? "declined" : paidState(cycle, !!m.lastCharge && isPaid(m.lastChargeStatus));
    const yearly = m.cadence === 12;
    rows.push({
      key: m.id,
      source: "patreon",
      name: m.name,
      email: m.email,
      url: m.url,
      tier: m.tierIds.map((t) => tierName.get(t)).filter(Boolean).join(", "),
      cents: m.cents,
      monthlyCents: yearly ? Math.round(m.cents / 12) : m.cents,
      yearly,
      since: m.since,
      lastCharge: m.lastCharge,
      lastChargeStatus: m.lastChargeStatus,
      nextCharge: m.nextCharge,
      state,
      cycleId,
      cycle,
      history: history(store, m.id, cycleId),
      discord: extra.discord || (m.discordId ? (discordNames[m.discordId] ?? "") : ""),
      discordAuto: !extra.discord && !!m.discordId && !!discordNames[m.discordId],
      discordLinked: !!m.discordId,
      bot: extra.bot ?? "",
      note: extra.note ?? "",
      manual: null,
    });
  }

  for (const [key, extra] of Object.entries(store.people)) {
    const man = extra.manual;
    if (!man) continue;
    const last = man.lastCharge ?? null;
    const cycleId = cycleIdFor(last, last ? "Paid" : null, Object.keys(store.cycles[key] ?? {}));
    const cycle = currentCycle(store, key, cycleId);
    rows.push({
      key,
      source: "manual",
      name: man.name,
      email: man.email ?? "",
      url: null,
      tier: man.tier ?? "",
      cents: man.cents ?? 0,
      monthlyCents: man.cents ?? 0,
      yearly: !!man.yearly,
      since: man.since ?? null,
      lastCharge: last,
      lastChargeStatus: last ? "Paid" : null,
      nextCharge: man.nextCharge ?? null,
      state: man.ended ? "former" : paidState(cycle, !!last),
      cycleId,
      cycle,
      history: history(store, key, cycleId),
      discord: extra.discord ?? "",
      discordAuto: false,
      discordLinked: false,
      bot: extra.bot ?? "",
      note: extra.note ?? "",
      manual: man,
    });
  }

  const next = (r: CircleRow) => (r.nextCharge ? r.nextCharge.slice(0, 10) : "9999");
  return rows.sort(
    (a, b) => Number(b.state === "contact") - Number(a.state === "contact") || next(a).localeCompare(next(b)) || a.name.localeCompare(b.name, "de"),
  );
}

/** Kalendertage von heute bis zum Datum (lokale Zeitzone), negativ = überfällig */
export function daysUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const d = DATED.test(iso) ? new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  return Math.round((day(d) - day(now)) / 86_400_000);
}

/** Ampel wie in der Google-Tabelle */
export function dayTone(d: number | null): "red" | "orange" | "green" | null {
  if (d === null) return null;
  return d <= 7 ? "red" : d <= 14 ? "orange" : "green";
}

export type CircleFilter = "all" | "contact" | "answer" | "deliver" | "soon" | "declined" | "former";

const isCurrent = (r: CircleRow) => r.state !== "former";

export function matchesFilter(r: CircleRow, f: CircleFilter, now: Date): boolean {
  switch (f) {
    case "all":
      return isCurrent(r);
    case "contact":
      return r.state === "contact";
    case "answer":
      return isCurrent(r) && r.cycle.contacted === "yes" && r.cycle.answer !== "yes";
    case "deliver":
      return isCurrent(r) && !!r.cycle.set?.trim() && r.cycle.hasIt !== "yes";
    case "soon": {
      const d = daysUntil(r.nextCharge, now);
      return isCurrent(r) && d !== null && d >= 0 && d <= 7;
    }
    case "declined":
      return r.state === "declined";
    case "former":
      return r.state === "former";
  }
}

export function circleStats(rows: CircleRow[]): { active: number; monthlyCents: number; toContact: number; waitingAnswer: number; toDeliver: number } {
  const active = rows.filter((r) => r.state === "contact" || r.state === "active" || r.state === "waiting");
  return {
    active: active.length,
    monthlyCents: active.reduce((s, r) => s + r.monthlyCents, 0),
    toContact: active.filter((r) => r.state === "contact").length,
    waitingAnswer: active.filter((r) => r.cycle.contacted === "yes" && r.cycle.answer !== "yes").length,
    toDeliver: active.filter((r) => !!r.cycle.set?.trim() && r.cycle.hasIt !== "yes").length,
  };
}

/** Alte Häkchen „angeschrieben“ (patreon-acks.json: Member → Abbuchung) einmalig übernehmen */
export function migrateAcks(store: CircleStore, acks: Record<string, string>): CircleStore {
  if (store.acksMigrated) return store;
  const out: CircleStore = structuredClone(store);
  for (const [key, charge] of Object.entries(acks)) {
    if (!charge) continue;
    const id = cycleIdFor(charge, "Paid", []);
    const own = (out.cycles[key] ??= {});
    const c = (own[id] ??= { updatedAt: Date.now() });
    c.contacted ??= "yes";
  }
  out.acksMigrated = true;
  return out;
}

/**
 * Reihenfolge beim Tippen stabil halten: bekannte Zeilen bleiben an ihrem Platz (sonst springt eine
 * Zeile nach „Angeschrieben ✓“ weg und der nächste Tipp trifft das falsche Mitglied), neue kommen ans
 * Ende, weggefallene raus. Neu sortiert wird erst beim Neuladen oder Filterwechsel.
 */
export function stableOrder(prev: string[], keys: string[]): string[] {
  const now = new Set(keys);
  const kept = prev.filter((k) => now.has(k));
  const known = new Set(kept);
  return [...kept, ...keys.filter((k) => !known.has(k))];
}
