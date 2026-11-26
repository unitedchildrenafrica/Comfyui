import { describe, expect, it } from "vitest";
import {
  type CircleRow,
  type CircleStore,
  buildRows,
  circleStats,
  currentCycle,
  cycleIdFor,
  dayTone,
  daysUntil,
  matchesFilter,
  migrateAcks,
  nextTri,
} from "@/lib/circle";
import type { PatreonMember, PatreonTier } from "@/lib/patreon";

const tiers: PatreonTier[] = [
  { id: "ic", title: "Inner Circle", amountCents: 4400 },
  { id: "fan", title: "Fan", amountCents: 500 },
];

function member(over: Partial<PatreonMember> = {}): PatreonMember {
  return {
    id: "m1",
    name: "Mark D",
    email: "mark@example.com",
    status: "active_patron",
    lastCharge: "2026-11-12T08:00:00.000+00:00",
    lastChargeStatus: "Paid",
    nextCharge: "2026-12-12T08:00:00.000+00:00",
    since: "2026-10-12T08:00:00.000+00:00",
    cents: 4400,
    cadence: 1,
    tierIds: ["ic"],
    url: "https://www.patreon.com/user?u=1",
    ...over,
  };
}

const empty = (): CircleStore => ({ people: {}, cycles: {} });
const snap = (members: PatreonMember[]) => ({ tiers, members });

describe("nextTri", () => {
  it("offen → Ja → Nein → offen", () => {
    expect(nextTri(undefined)).toBe("yes");
    expect(nextTri("yes")).toBe("no");
    expect(nextTri("no")).toBeUndefined();
  });
});

describe("cycleIdFor", () => {
  it("bezahlte Abbuchung = ihr Datum", () => {
    expect(cycleIdFor("2026-11-12T08:00:00+00:00", "Paid", [])).toBe("2026-11-12");
  });
  it("abgelehnt: jüngster gespeicherter Zyklus", () => {
    expect(cycleIdFor("2026-11-28T08:00:00+00:00", "Declined", ["2026-09-28", "start", "2026-10-28"])).toBe("2026-10-28");
  });
  it("ausstehend ohne gespeicherten Zyklus oder gar keine Abbuchung: start", () => {
    expect(cycleIdFor("2026-11-28T08:00:00+00:00", "Pending", [])).toBe("start");
    expect(cycleIdFor(null, null, [])).toBe("start");
  });
  it("gespeicherte Zyklen nach der Abbuchung zählen nicht", () => {
    expect(cycleIdFor("2026-11-28T08:00:00+00:00", "Refunded", ["2026-12-28"])).toBe("start");
  });
});

describe("currentCycle", () => {
  it("übernimmt Werte aus start, solange der datierte Zyklus fehlt", () => {
    const s = empty();
    s.cycles.k = { start: { set: "Bombchu", contacted: "yes", updatedAt: 1 } };
    expect(currentCycle(s, "k", "2026-11-12")).toMatchObject({ set: "Bombchu", contacted: "yes" });
    s.cycles.k["2026-11-12"] = { set: "Rosalina", updatedAt: 2 };
    expect(currentCycle(s, "k", "2026-11-12")).toMatchObject({ set: "Rosalina" });
    expect(currentCycle(s, "k", "2026-11-12").contacted).toBeUndefined();
  });
});

describe("buildRows", () => {
  it("neue Zahlung: Zeile wieder offen, alter Monat im Verlauf", () => {
    const s = empty();
    s.cycles.m1 = { "2026-10-12": { contacted: "yes", set: "Bombchu 200", updatedAt: 1 } };
    const [row] = buildRows(snap([member()]), ["ic"], s);
    expect(row.state).toBe("contact");
    expect(row.cycleId).toBe("2026-11-12");
    expect(row.cycle.contacted).toBeUndefined();
    expect(row.history.map((h) => h.cycleId)).toEqual(["2026-10-12"]);
    expect(row.tier).toBe("Inner Circle");
  });

  it("im aktuellen Monat angeschrieben: aktiv", () => {
    const s = empty();
    s.cycles.m1 = { "2026-11-12": { contacted: "yes", updatedAt: 1 } };
    expect(buildRows(snap([member()]), ["ic"], s)[0].state).toBe("active");
  });

  it("Übertrag aus start erscheint nicht doppelt im Verlauf", () => {
    const s = empty();
    s.cycles.m1 = { start: { set: "Bombchu", updatedAt: 1 } };
    const [row] = buildRows(snap([member()]), ["ic"], s);
    expect(row.cycle.set).toBe("Bombchu");
    expect(row.history).toEqual([]);
  });

  it("ehemalig, abgelehnt, ausstehend, andere Stufe", () => {
    const rows = buildRows(
      snap([
        member({ id: "a", status: "former_patron" }),
        member({ id: "b", status: "declined_patron", lastChargeStatus: "Declined" }),
        member({ id: "c", lastChargeStatus: "Pending" }),
        member({ id: "d", tierIds: ["fan"] }),
      ]),
      ["ic"],
      empty(),
    );
    const by = Object.fromEntries(rows.map((r) => [r.key, r.state]));
    expect(by).toEqual({ a: "former", b: "declined", c: "waiting" });
  });

  it("tracked null = alle Stufen", () => {
    expect(buildRows(snap([member({ id: "d", tierIds: ["fan"] })]), null, empty())).toHaveLength(1);
  });

  it("Hand-Mitglied: aktiv nach Zyklus, beendet = ehemalig", () => {
    const s = empty();
    s.people.m_x = { discord: "falcon", manual: { name: "Falcon", cents: 4400, yearly: true, lastCharge: "2025-06-15", nextCharge: "2027-06-15" } };
    s.people.m_y = { manual: { name: "Weg", ended: true } };
    const rows = buildRows(null, null, s);
    const f = rows.find((r) => r.key === "m_x")!;
    expect(f).toMatchObject({ source: "manual", name: "Falcon", state: "contact", cycleId: "2025-06-15", discord: "falcon", monthlyCents: 4400, yearly: true });
    expect(rows.find((r) => r.key === "m_y")!.state).toBe("former");
  });

  it("Betrag pro Monat: jährliche Patreon-Zahler durch 12", () => {
    const rows = buildRows(snap([member({ id: "y", cadence: 12, cents: 52800 }), member({ id: "mo" })]), ["ic"], empty());
    expect(Object.fromEntries(rows.map((r) => [r.key, r.monthlyCents]))).toEqual({ y: 4400, mo: 4400 });
  });

  it("Sortierung: anschreiben zuerst, dann nächste Zahlung, dann Name", () => {
    const s = empty();
    s.cycles.late = { "2026-11-12": { contacted: "yes", updatedAt: 1 } };
    s.cycles.soon = { "2026-11-12": { contacted: "yes", updatedAt: 1 } };
    const rows = buildRows(
      snap([
        member({ id: "late", name: "B", nextCharge: "2026-12-20T00:00:00Z" }),
        member({ id: "soon", name: "C", nextCharge: "2026-12-01T00:00:00Z" }),
        member({ id: "todo", name: "Z", nextCharge: "2026-12-30T00:00:00Z" }),
      ]),
      ["ic"],
      s,
    );
    expect(rows.map((r) => r.key)).toEqual(["todo", "soon", "late"]);
  });
});

describe("Tage bis Zahlung", () => {
  it("Kalendertage in lokaler Zeit", () => {
    expect(daysUntil("2026-12-12T08:00:00.000+00:00", new Date(2026, 10, 26, 23, 0))).toBe(16);
    expect(daysUntil("2026-11-20", new Date(2026, 10, 26, 12, 0))).toBe(-6);
    expect(daysUntil(null, new Date())).toBeNull();
  });
  it("Ampel", () => {
    expect([-3, 7, 8, 14, 15, null].map(dayTone)).toEqual(["red", "red", "orange", "orange", "green", null]);
  });
});

describe("Filter und Kennzahlen", () => {
  const now = new Date(2026, 10, 26, 12, 0);
  const row = (over: Partial<CircleRow>): CircleRow => ({ ...buildRows(snap([member()]), ["ic"], empty())[0], ...over });

  it("Filter", () => {
    expect(matchesFilter(row({ cycle: { contacted: "yes", updatedAt: 1 } }), "answer", now)).toBe(true);
    expect(matchesFilter(row({ cycle: { contacted: "yes", answer: "yes", updatedAt: 1 } }), "answer", now)).toBe(false);
    expect(matchesFilter(row({ cycle: { set: "Bombchu", updatedAt: 1 } }), "deliver", now)).toBe(true);
    expect(matchesFilter(row({ cycle: { set: "Bombchu", hasIt: "yes", updatedAt: 1 } }), "deliver", now)).toBe(false);
    expect(matchesFilter(row({ cycle: { set: "  ", updatedAt: 1 } }), "deliver", now)).toBe(false);
    expect(matchesFilter(row({ nextCharge: "2026-12-01" }), "soon", now)).toBe(true);
    expect(matchesFilter(row({ nextCharge: "2026-12-12" }), "soon", now)).toBe(false);
    expect(matchesFilter(row({ state: "former" }), "all", now)).toBe(false);
    expect(matchesFilter(row({ state: "former" }), "former", now)).toBe(true);
    expect(matchesFilter(row({ state: "contact" }), "contact", now)).toBe(true);
    expect(matchesFilter(row({ state: "declined" }), "declined", now)).toBe(true);
  });

  it("Kennzahlen zählen nur aktive", () => {
    const stats = circleStats([
      row({ state: "contact", monthlyCents: 4400 }),
      row({ state: "active", monthlyCents: 3400, cycle: { contacted: "yes", set: "X", updatedAt: 1 } }),
      row({ state: "declined", monthlyCents: 4400 }),
      row({ state: "former", monthlyCents: 4400 }),
    ]);
    expect(stats).toEqual({ active: 2, monthlyCents: 7800, toContact: 1, waitingAnswer: 1, toDeliver: 1 });
  });
});

describe("migrateAcks", () => {
  it("übernimmt alte Häkchen genau einmal", () => {
    const once = migrateAcks(empty(), { m1: "2026-11-12T08:00:00.000+00:00" });
    expect(once.acksMigrated).toBe(true);
    expect(once.cycles.m1["2026-11-12"].contacted).toBe("yes");
    once.cycles.m1["2026-11-12"].contacted = "no"; // danach vom Nutzer geändert
    const twice = migrateAcks(once, { m1: "2026-11-12T08:00:00.000+00:00" });
    expect(twice.cycles.m1["2026-11-12"].contacted).toBe("no");
  });
});

describe("Schlussprüfung: start nur in den ersten Zahlungsmonat", () => {
  it("zweite Zahlung beginnt offen, auch wenn es einen start-Eintrag gibt", () => {
    const s = empty();
    s.cycles.m1 = { start: { contacted: "yes", set: "Bombchu", updatedAt: 1 }, "2026-11-12": { hasIt: "yes", updatedAt: 2 } };
    const [row] = buildRows(snap([member({ lastCharge: "2026-12-12T08:00:00.000+00:00" })]), ["ic"], s);
    expect(row.cycleId).toBe("2026-12-12");
    expect(row.cycle.contacted).toBeUndefined();
    expect(row.cycle.set).toBeUndefined();
    expect(row.state).toBe("contact");
  });
});

describe("Schlussprüfung: stabile Reihenfolge beim Tippen", () => {
  it("behält bekannte Zeilen an ihrem Platz, neue kommen ans Ende, weggefallene raus", async () => {
    const { stableOrder } = await import("@/lib/circle");
    expect(stableOrder(["a", "b", "c"], ["b", "c", "a", "d"])).toEqual(["a", "b", "c", "d"]);
    expect(stableOrder(["a", "b", "c"], ["c", "a"])).toEqual(["a", "c"]);
    expect(stableOrder([], ["x", "y"])).toEqual(["x", "y"]);
  });
});
