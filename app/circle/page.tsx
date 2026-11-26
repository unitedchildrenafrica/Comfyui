"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBox } from "@/components/ui";
import { type CircleFilter, type CircleRow, type ManualMember, type Tri, circleStats, matchesFilter, stableOrder } from "@/lib/circle";
import { api, ApiError } from "@/lib/client";
import type { PatreonTier } from "@/lib/patreon";
import { CircleTable, type CycleField } from "./CircleTable";
import { dollars, todayIso } from "./format";
import { MemberSheet } from "./MemberSheet";
import { CIRCLE_CHANGED } from "@/components/notes/useCircle";

interface CircleView {
  configured: boolean;
  syncedAt: number | null;
  error: string | null;
  tiers: PatreonTier[];
  trackedTiers: string[] | null;
  rows: CircleRow[];
}

const FILTERS: { id: CircleFilter; label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "contact", label: "Anschreiben" },
  { id: "answer", label: "Wartet auf Antwort" },
  { id: "deliver", label: "Set liefern" },
  { id: "soon", label: "Zahlt bald" },
  { id: "declined", label: "Abgelehnt" },
  { id: "former", label: "Ehemalige" },
];

const SETUP_CMD = "bash /root/setup-server.sh patreon";

/**
 * Passen alle Spalten nebeneinander? Gemessen an der echten Breite (Handy, aber auch Rechner mit
 * offener Notizen-Leiste). Sonst kommen die Spalten zum Antippen direkt nach dem Namen.
 */
const FULL_TABLE_PX = 1250;
function useNarrow(ref: React.RefObject<HTMLElement | null>) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < FULL_TABLE_PX));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return narrow;
}

export default function CirclePage() {
  const [view, setView] = useState<CircleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<CircleFilter>("all");
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState<{ key: string | null } | null>(null);
  const [showTiers, setShowTiers] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  /** Zeilen-Reihenfolge; bleibt beim Tippen stehen, neu sortiert wird beim Laden und Filterwechsel */
  const [order, setOrder] = useState<string[]>([]);
  const mainRef = useRef<HTMLElement>(null);
  const narrow = useNarrow(mainRef);
  const now = useMemo(() => new Date(), [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    try {
      const v = await api<CircleView>("/api/circle");
      setOrder([]);
      setView(v);
      setError(null);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }, []);
  useEffect(() => {
    load();
    api<{ folders: string[] }>("/api/zip?list=1").then((r) => setFolders(r.folders), () => {});
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  /** Aktion an den Server; der liefert den neuen Stand. Bei Fehler: Meldung und Stand neu laden. */
  const post = useCallback(
    async (json: Record<string, unknown>) => {
      setBusy(true);
      try {
        setView(await api<CircleView>("/api/circle", { method: "POST", json }));
        setError(null);
        // Zähler „anschreiben“ in der Notizen-Leiste nachziehen
        window.dispatchEvent(new Event(CIRCLE_CHANGED));
        return true;
      } catch (err) {
        setError((err as ApiError).message);
        load();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  // Sofort umschalten (nicht auf den Server warten), dann speichern
  const patchRow = (key: string, fn: (r: CircleRow) => CircleRow) => setView((v) => (v ? { ...v, rows: v.rows.map((r) => (r.key === key ? fn(r) : r)) } : v));
  const onTri = (row: CircleRow, field: CycleField, value: Tri | undefined) => {
    patchRow(row.key, (r) => ({ ...r, cycle: { ...r.cycle, [field]: value }, state: field === "contacted" && r.state === "contact" && value === "yes" ? "active" : r.state }));
    post({ action: "cycle", key: row.key, cycleId: row.cycleId, field, value: value ?? null });
  };
  const onText = (row: CircleRow, field: "discord" | "bot" | "set", value: string) => {
    if (field === "set") {
      patchRow(row.key, (r) => ({ ...r, cycle: { ...r.cycle, set: value } }));
      post({ action: "cycle", key: row.key, cycleId: row.cycleId, field: "set", value: value || null });
    } else {
      patchRow(row.key, (r) => ({ ...r, [field]: value }));
      post({ action: "person", key: row.key, field, value });
    }
  };

  useEffect(() => {
    if (view) setOrder((prev) => stableOrder(prev, view.rows.map((r) => r.key)));
  }, [view]);
  const chooseFilter = (f: CircleFilter) => {
    setFilter(f);
    if (view) setOrder(view.rows.map((r) => r.key));
  };
  const byKey = new Map((view?.rows ?? []).map((r) => [r.key, r]));
  const rows = order.length ? order.map((k) => byKey.get(k)).filter((r): r is CircleRow => !!r) : (view?.rows ?? []);
  const stats = circleStats(rows);
  const q = query.trim().toLowerCase();
  const searched = rows.filter((r) => !q || `${r.name} ${r.email} ${r.discord} ${r.bot} ${r.cycle.set ?? ""}`.toLowerCase().includes(q));
  const shown = searched.filter((r) => matchesFilter(r, filter, now));
  const count = (f: CircleFilter) => searched.filter((r) => matchesFilter(r, f, now)).length;
  const sets = useMemo(
    () => [...new Set([...folders, ...rows.flatMap((r) => [r.cycle.set, ...r.history.map((h) => h.data.set)]).filter((s): s is string => !!s)])].sort((a, b) => a.localeCompare(b, "de")),
    [folders, rows],
  );
  const sheetRow = sheet?.key ? (rows.find((r) => r.key === sheet.key) ?? null) : null;
  const tracked = view?.trackedTiers ? new Set(view.trackedTiers) : null;

  const toggleTier = (id: string) => {
    if (!view) return;
    const all = view.tiers.map((t) => t.id);
    const cur = new Set(tracked ?? all);
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    post({ action: "tiers", tiers: cur.size === all.length ? null : [...cur] });
  };

  return (
    <main ref={mainRef} className="mx-auto max-w-[1400px] space-y-3 px-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))", paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h1 className="text-lg font-semibold">👑 Inner Circle</h1>
        <span className="flex items-center gap-3 text-sm">
          {view?.syncedAt && <span className="text-muted">Stand {new Date(view.syncedAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
          {view?.configured && (
            <button type="button" className="text-accent underline" disabled={busy} onClick={() => post({ action: "sync" })}>
              {busy ? "…" : "↻ Patreon"}
            </button>
          )}
        </span>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {view?.error && <ErrorBox>Patreon: {view.error} – es gilt der letzte Stand.</ErrorBox>}
      {view && !view.configured && (
        <section className="card space-y-2 p-3 text-sm">
          <p className="font-semibold">Patreon noch nicht verbunden</p>
          <p className="text-soft">Einmal auf dem Server ausführen und die Werte aus dem Patreon-Portal eingeben – danach füllt sich die Tabelle von selbst. Mitglieder von Hand gehen schon jetzt.</p>
          <pre className="overflow-x-auto rounded-lg bg-bg px-3 py-2 font-mono text-[13px]">{SETUP_CMD}</pre>
        </section>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: "Aktive Mitglieder", value: String(stats.active), cls: "", f: "all" as CircleFilter },
          { label: "Pro Monat", value: dollars(stats.monthlyCents), cls: "", f: "all" as CircleFilter },
          { label: "Noch anschreiben", value: String(stats.toContact), cls: stats.toContact ? "text-amber-300" : "", f: "contact" as CircleFilter },
          { label: "Warten auf Antwort", value: String(stats.waitingAnswer), cls: "", f: "answer" as CircleFilter },
          { label: "Set noch liefern", value: String(stats.toDeliver), cls: stats.toDeliver ? "text-emerald-300" : "", f: "deliver" as CircleFilter },
        ].map((s, i) => (
          <button key={s.label} type="button" className={`card p-3 text-left ${i === 4 ? "col-span-2 sm:col-span-1" : ""}`} onClick={() => chooseFilter(s.f)}>
            <span className="block text-xs text-muted">{s.label}</span>
            <span className={`block text-xl font-bold ${s.cls}`}>{view ? s.value : "…"}</span>
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => chooseFilter(f.id)}
            className={`min-h-9 shrink-0 rounded-full border px-3 text-sm ${filter === f.id ? "border-accent bg-accent text-white" : "border-line text-soft"}`}
          >
            {f.label} {count(f.id)}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input className="input min-w-0 flex-1" type="search" placeholder="Suchen (Name, Discord, Bot, Set) …" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="btn btn-ghost shrink-0 px-3" onClick={() => setSheet({ key: null })}>
          ＋ Mitglied
        </button>
      </div>

      {!view && !error && <p className="px-1 text-sm text-muted">Lade …</p>}
      {view && !shown.length && <p className="px-1 text-sm text-muted">{rows.length ? "Niemand in dieser Auswahl." : "Noch keine Mitglieder."}</p>}
      {shown.length > 0 && <CircleTable rows={shown} now={now} narrow={narrow} actions={{ onTri, onText, onOpen: (r) => setSheet({ key: r.key }) }} />}
      <datalist id="circle-sets">
        {sets.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <p className="px-1 text-xs text-muted">
        Angeschrieben · Antwort · Set · Hat es gelten pro Zahlung – bei der nächsten Abbuchung stehen sie wieder auf „offen“. Den Verlauf siehst du, wenn du einen Namen antippst.
      </p>

      {view && view.tiers.length > 0 && (
        <section className="space-y-2 px-1">
          <button type="button" className="text-xs text-muted underline" onClick={() => setShowTiers(!showTiers)}>
            {showTiers ? "Stufen ausblenden" : "Welche Patreon-Stufen? …"}
          </button>
          {showTiers && (
            <div className="flex flex-wrap gap-1.5">
              {view.tiers.map((t) => {
                const on = !tracked || tracked.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTier(t.id)}
                    className={`min-h-8 rounded-full border px-3 text-xs ${on ? "border-accent text-accent" : "border-line text-muted line-through"}`}
                  >
                    {t.title}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {sheet && (sheet.key === null || sheetRow) && (
        <MemberSheet
          key={sheet.key ?? "neu"}
          row={sheetRow}
          busy={busy}
          onClose={() => setSheet(null)}
          onPerson={(field, value) => sheetRow && post({ action: "person", key: sheetRow.key, field, value })}
          onSaveManual={async (m: Partial<ManualMember>) => {
            const ok = sheetRow ? await post({ action: "edit", key: sheetRow.key, member: m }) : await post({ action: "add", member: m });
            if (ok && !sheetRow) setSheet(null);
          }}
          onPaid={() => sheetRow && post({ action: "paid", key: sheetRow.key, today: todayIso() })}
          onRemove={async () => {
            if (sheetRow && (await post({ action: "remove", key: sheetRow.key }))) setSheet(null);
          }}
        />
      )}
    </main>
  );
}
