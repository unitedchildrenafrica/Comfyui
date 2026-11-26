"use client";

import { useState } from "react";
import { type CircleRow, type ManualMember } from "@/lib/circle";
import { cycleLabel, dayLabel, dollars, todayIso } from "./format";

const tri = (v: string | undefined) => (v === "yes" ? "✓" : v === "no" ? "✗" : "–");

interface Props {
  /** null = neues Hand-Mitglied */
  row: CircleRow | null;
  busy: boolean;
  onClose: () => void;
  onPerson: (field: "discord" | "bot" | "note", value: string) => void;
  onSaveManual: (m: Partial<ManualMember>) => void;
  onPaid: () => void;
  onRemove: () => void;
}

function ManualForm({ initial, busy, onSave, isNew }: { initial: ManualMember | null; busy: boolean; onSave: (m: Partial<ManualMember>) => void; isNew: boolean }) {
  const [f, setF] = useState({
    name: initial?.name ?? "",
    tier: initial?.tier ?? "Inner Circle",
    dollars: initial?.cents ? String(initial.cents / 100) : "",
    yearly: !!initial?.yearly,
    since: initial?.since ?? "",
    lastCharge: initial?.lastCharge ?? "",
    nextCharge: initial?.nextCharge ?? "",
    email: initial?.email ?? "",
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const cents = Math.round(Number(f.dollars.replace(",", ".")) * 100);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name: f.name,
          tier: f.tier,
          cents: Number.isFinite(cents) && cents > 0 ? cents : 0,
          yearly: f.yearly,
          since: f.since || null,
          lastCharge: f.lastCharge || null,
          nextCharge: f.nextCharge || null,
          email: f.email,
        });
      }}
    >
      <label className="block text-xs text-muted">
        Name
        <input className="input mt-1" required maxLength={80} value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-muted">
          Stufe
          <input className="input mt-1" maxLength={60} value={f.tier} onChange={(e) => set({ tier: e.target.value })} />
        </label>
        <label className="block text-xs text-muted">
          $ pro Monat
          <input className="input mt-1" inputMode="decimal" value={f.dollars} onChange={(e) => set({ dollars: e.target.value })} placeholder="44" />
        </label>
      </div>
      <label className="flex min-h-10 items-center gap-2 text-sm text-soft">
        <input type="checkbox" className="h-5 w-5" checked={f.yearly} onChange={(e) => set({ yearly: e.target.checked })} />
        zahlt jährlich (nächste Zahlung + 12 Monate)
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="block text-xs text-muted">
          Beitritt
          <input type="date" className="input mt-1 px-2" value={f.since} onChange={(e) => set({ since: e.target.value })} />
        </label>
        <label className="block text-xs text-muted">
          Letzte Zahlung
          <input type="date" className="input mt-1 px-2" value={f.lastCharge} onChange={(e) => set({ lastCharge: e.target.value })} />
        </label>
        <label className="block text-xs text-muted">
          Nächste Zahlung
          <input type="date" className="input mt-1 px-2" value={f.nextCharge} onChange={(e) => set({ nextCharge: e.target.value })} />
        </label>
      </div>
      <label className="block text-xs text-muted">
        E-Mail (optional)
        <input className="input mt-1" type="email" maxLength={200} value={f.email} onChange={(e) => set({ email: e.target.value })} />
      </label>
      <button type="submit" className="btn btn-primary w-full" disabled={busy || !f.name.trim()}>
        {isNew ? "＋ Mitglied anlegen" : "Speichern"}
      </button>
    </form>
  );
}

export function MemberSheet({ row, busy, onClose, onPerson, onSaveManual, onPaid, onRemove }: Props) {
  const [note, setNote] = useState(row?.note ?? "");
  const isNew = row === null;
  const manual = row?.manual ?? null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        className="card max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-b-none p-4 sm:rounded-b-[14px]"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-semibold">{isNew ? "Neues Mitglied (ohne Patreon)" : row.name}</h2>
            {row && (
              <p className="text-xs text-muted">
                {row.source === "patreon" ? "von Patreon" : "von Hand"} · {row.tier || "–"}
                {row.cents ? ` · ${dollars(row.monthlyCents)}/Monat` : ""} · nächste Zahlung {dayLabel(row.nextCharge)}
              </p>
            )}
          </div>
          <button type="button" className="btn btn-ghost shrink-0 px-3" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>

        {row && (
          <div className="flex flex-wrap gap-2 text-sm">
            {row.email && (
              <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => navigator.clipboard?.writeText(row.email).catch(() => {})}>
                📋 {row.email}
              </button>
            )}
            {row.url && (
              <a className="btn btn-ghost min-h-9 px-3 text-sm" href={row.url} target="_blank" rel="noreferrer">
                Patreon-Profil ↗
              </a>
            )}
          </div>
        )}

        {row && (
          <label className="block text-xs text-muted">
            Notiz
            <textarea
              className="input mt-1 min-h-20 text-sm"
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note.trim() !== row.note && onPerson("note", note)}
              placeholder="z. B. mag lieber Videos, schreibt nur abends …"
            />
          </label>
        )}

        {row && (
          <section className="space-y-1">
            <h3 className="text-sm font-semibold">Verlauf</h3>
            <ul className="divide-y divide-line rounded-xl border border-line text-sm">
              <li className="flex flex-wrap gap-x-3 px-3 py-2">
                <span className="font-medium">{cycleLabel(row.cycleId)} (jetzt)</span>
                <span className="text-muted">
                  angeschrieben {tri(row.cycle.contacted)} · Antwort {tri(row.cycle.answer)}
                  {row.cycle.answerAt ? ` (${new Date(row.cycle.answerAt).toLocaleDateString("de-DE")})` : ""} · Set {row.cycle.set || "–"} · hat es {tri(row.cycle.hasIt)}
                </span>
              </li>
              {row.history.map((h) => (
                <li key={h.cycleId} className="flex flex-wrap gap-x-3 px-3 py-2">
                  <span className="font-medium">{cycleLabel(h.cycleId)}</span>
                  <span className="text-muted">
                    angeschrieben {tri(h.data.contacted)} · Antwort {tri(h.data.answer)} · Set {h.data.set || "–"} · hat es {tri(h.data.hasIt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(isNew || manual) && (
          <section className="space-y-3">
            {manual && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={onPaid} title={`letzte Zahlung = ${dayLabel(todayIso())}`}>
                  💰 Zahlung erhalten
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onSaveManual({ ended: !manual.ended })}>
                  {manual.ended ? "↺ Wieder aktiv" : "Mitglied beendet"}
                </button>
              </div>
            )}
            <ManualForm key={row?.key ?? "neu"} initial={manual} busy={busy} onSave={onSaveManual} isNew={isNew} />
            {manual && (
              <button
                type="button"
                className="btn btn-danger w-full"
                disabled={busy}
                onClick={() => window.confirm(`„${manual.name}“ samt Verlauf löschen?`) && onRemove()}
              >
                🗑 Mitglied löschen
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
