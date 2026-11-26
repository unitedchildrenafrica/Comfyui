"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { type CircleRow, type Tri, dayTone, daysUntil, nextTri } from "@/lib/circle";
import { dayLabel, dollars } from "./format";

export type CycleField = "contacted" | "answer" | "hasIt";

export interface TableActions {
  onTri: (row: CircleRow, field: CycleField, value: Tri | undefined) => void;
  onText: (row: CircleRow, field: "discord" | "bot" | "set", value: string) => void;
  onOpen: (row: CircleRow) => void;
}

type ColId = "name" | "discord" | "bot" | "tier" | "cents" | "since" | "last" | "next" | "days" | "contacted" | "answer" | "set" | "hasIt";

// Rechner: wie die Google-Tabelle. Handy: was man antippt, direkt nach dem Namen.
const WIDE: ColId[] = ["name", "discord", "bot", "tier", "cents", "since", "last", "next", "days", "contacted", "answer", "set", "hasIt"];
const NARROW: ColId[] = ["name", "days", "contacted", "answer", "set", "hasIt", "discord", "bot", "tier", "cents", "since", "last", "next"];

const LABEL: Record<ColId, string> = {
  name: "Mitglied",
  discord: "Discord",
  bot: "Bot",
  tier: "Stufe",
  cents: "$/Monat",
  since: "Beitritt",
  last: "Letzte Zahlung",
  next: "Nächste Zahlung",
  days: "Tage",
  contacted: "Angeschrieben",
  answer: "Antwort",
  set: "Set gewünscht",
  hasIt: "Hat es",
};

const TONE = { red: "bg-red-500/25 text-red-200", orange: "bg-amber-500/25 text-amber-200", green: "bg-emerald-500/20 text-emerald-200" } as const;

function TriCell({ value, onChange }: { value: Tri | undefined; onChange: (v: Tri | undefined) => void }) {
  const cls =
    value === "yes"
      ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
      : value === "no"
        ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
        : "border-dashed border-line text-muted";
  return (
    <button type="button" className={`min-h-9 min-w-[4.5rem] rounded-full border px-3 text-xs font-semibold ${cls}`} onClick={() => onChange(nextTri(value))}>
      {value === "yes" ? "✓ Ja" : value === "no" ? "✗ Nein" : "offen"}
    </button>
  );
}

/** Text zum Antippen: zeigt den Wert, beim Antippen ein Eingabefeld (Enter/Verlassen speichert, Esc bricht ab) */
export function EditCell({
  value,
  placeholder,
  onSave,
  list,
  maxLength,
  auto,
}: {
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
  list?: string;
  maxLength: number;
  /** Wert kam automatisch (z. B. Discord) – mit 🔗 markieren */
  auto?: boolean;
}) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  // Enter speichert und schließt – das folgende Blur darf nicht noch einmal speichern
  const closed = useRef(false);
  useEffect(() => {
    if (edit) {
      closed.current = false;
      input.current?.focus();
    }
  }, [edit]);
  const done = (save: boolean) => {
    if (closed.current) return;
    closed.current = true;
    setEdit(false);
    if (save && draft.trim() !== value) onSave(draft.trim());
  };
  if (edit)
    return (
      <input
        ref={input}
        className="input h-9 min-w-[9rem] py-1 text-sm"
        value={draft}
        list={list}
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => done(true)}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === "Enter") done(true);
          if (e.key === "Escape") done(false);
        }}
      />
    );
  return (
    <button
      type="button"
      className={`min-h-9 max-w-[14rem] truncate rounded-lg px-2 text-left text-sm ${value ? "border border-line bg-bg" : "border border-dashed border-line text-muted"}`}
      title={auto ? "Automatisch über Patreon/Discord – antippen, um selbst einen Namen einzutragen" : undefined}
      onClick={() => {
        setDraft(value);
        setEdit(true);
      }}
    >
      {auto && <span aria-label="automatisch">🔗 </span>}
      {value || placeholder}
    </button>
  );
}

function lastPayment(r: CircleRow): ReactNode {
  if (!r.lastCharge) return <span className="text-muted">noch keine</span>;
  const s = (r.lastChargeStatus ?? "").toLowerCase();
  const mark = s === "paid" ? " ✓" : s === "declined" ? " ✗ abgelehnt" : ` · ${r.lastChargeStatus ?? "?"}`;
  return (
    <span className={s === "declined" ? "text-red-300" : s === "paid" ? "text-soft" : "text-amber-200"}>
      {dayLabel(r.lastCharge)}
      {mark}
      {r.yearly ? " (jährlich)" : ""}
    </span>
  );
}

export function CircleTable({ rows, now, narrow, actions }: { rows: CircleRow[]; now: Date; narrow: boolean; actions: TableActions }) {
  const cols = narrow ? NARROW : WIDE;
  const cell = (r: CircleRow, c: ColId): ReactNode => {
    switch (c) {
      case "name":
        return (
          <button type="button" className="text-left font-semibold leading-tight underline-offset-2 hover:underline" onClick={() => actions.onOpen(r)}>
            {r.name}
            {r.source === "manual" && <span className="ml-1 text-[11px] font-normal text-muted">(von Hand)</span>}
          </button>
        );
      case "discord":
        return <EditCell value={r.discord} auto={r.discordAuto} placeholder="＋ eintragen" maxLength={100} onSave={(v) => actions.onText(r, "discord", v)} />;
      case "bot":
        return <EditCell value={r.bot} placeholder="–" maxLength={100} onSave={(v) => actions.onText(r, "bot", v)} />;
      case "tier":
        return r.tier || "–";
      case "cents":
        return r.cents ? dollars(r.monthlyCents) : "–";
      case "since":
        return <span className="text-soft">{dayLabel(r.since)}</span>;
      case "last":
        return lastPayment(r);
      case "next":
        return <span className="text-soft">{dayLabel(r.nextCharge)}</span>;
      case "days": {
        const d = daysUntil(r.nextCharge, now);
        const tone = dayTone(d);
        return <span className={`inline-block min-w-10 rounded-lg px-2 py-1 text-center font-bold ${tone ? TONE[tone] : "text-muted"}`}>{d ?? "–"}</span>;
      }
      case "contacted":
      case "answer":
      case "hasIt":
        return <TriCell value={r.cycle[c]} onChange={(v) => actions.onTri(r, c, v)} />;
      case "set":
        return <EditCell value={r.cycle.set ?? ""} placeholder="＋ Set wählen" list="circle-sets" maxLength={200} onSave={(v) => actions.onText(r, "set", v)} />;
    }
  };
  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th
                key={c}
                className={`whitespace-nowrap border-b border-line bg-[#1b2030] px-3 py-2 text-left text-xs font-semibold text-soft ${i === 0 ? "sticky left-0 z-20 border-r" : ""}`}
              >
                {LABEL[c]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.state === "former" || r.state === "declined" ? "opacity-75" : ""}>
              {cols.map((c, i) => (
                <td key={c} className={`whitespace-nowrap border-b border-line px-3 py-1.5 align-middle ${i === 0 ? "sticky left-0 z-10 max-w-[9.5rem] border-r bg-card whitespace-normal" : ""}`}>
                  {cell(r, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
