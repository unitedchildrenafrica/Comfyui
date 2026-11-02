// Patreon-Mitglieder (Inner Circle): Typen und reine Logik für „hat gezahlt – anschreiben“.

export interface PatreonTier {
  id: string;
  title: string;
  amountCents: number;
}

export interface PatreonMember {
  id: string;
  name: string;
  email: string;
  /** active_patron | declined_patron | former_patron | null (nie gezahlt) */
  status: string | null;
  /** ISO-Datum der letzten Abbuchung */
  lastCharge: string | null;
  /** Paid, Declined, Pending, Refunded, … */
  lastChargeStatus: string | null;
  nextCharge: string | null;
  since: string | null;
  cents: number;
  /** Abrechnungsintervall in Monaten (1 = monatlich, 12 = jährlich) */
  cadence: number | null;
  tierIds: string[];
  /** Patreon-Profil */
  url: string | null;
}

export type MemberState = "contact" | "declined" | "done" | "waiting" | "former";

export interface MemberView extends PatreonMember {
  state: MemberState;
  /** Abbuchung, für die schon „angeschrieben“ abgehakt wurde */
  ackedCharge: string | null;
}

export const isPaid = (s: string | null) => (s ?? "").toLowerCase() === "paid";

/**
 * - contact:  aktive Zahlung, für diese Abbuchung noch nicht angeschrieben
 * - done:     für die letzte Abbuchung schon angeschrieben → Pause bis zur nächsten
 * - declined: Zahlung abgelehnt (nichts schicken)
 * - waiting:  aktiv, aber noch keine erfolgreiche Abbuchung (z. B. ausstehend)
 * - former:   kein Mitglied mehr
 */
export function memberState(m: PatreonMember, ackedCharge: string | null | undefined): MemberState {
  if (m.status === "former_patron" || !m.status) return "former";
  if (m.status === "declined_patron" || (m.lastChargeStatus ?? "").toLowerCase() === "declined") return "declined";
  if (!m.lastCharge || !isPaid(m.lastChargeStatus)) return "waiting";
  return ackedCharge === m.lastCharge ? "done" : "contact";
}

export function viewMembers(members: PatreonMember[], acks: Record<string, string>, trackedTiers: string[] | null): MemberView[] {
  const tracked = trackedTiers ? new Set(trackedTiers) : null;
  const order: Record<MemberState, number> = { contact: 0, declined: 1, waiting: 2, done: 3, former: 4 };
  return members
    .filter((m) => !tracked || m.tierIds.some((t) => tracked.has(t)))
    .map((m) => ({ ...m, ackedCharge: acks[m.id] ?? null, state: memberState(m, acks[m.id]) }))
    .sort((a, b) => order[a.state] - order[b.state] || (b.lastCharge ?? "").localeCompare(a.lastCharge ?? "") || a.name.localeCompare(b.name, "de"));
}

/** Standard-Auswahl: Stufen mit „Inner Circle“ im Namen, sonst alle */
export function defaultTiers(tiers: PatreonTier[]): string[] | null {
  const ic = tiers.filter((t) => /inner\s*circle/i.test(t.title)).map((t) => t.id);
  return ic.length ? ic : null;
}

/** „2026-11-01T12:00:00.000+00:00“ → „01.11.2026“ */
export function deDate(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}
