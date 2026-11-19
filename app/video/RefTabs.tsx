"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { REF_TABS_DEFAULT, REF_TABS_MAX } from "@/lib/h3refs";
import type { H3Ref } from "@/lib/types";

const sameRefs = (a: H3Ref[], b: H3Ref[]) =>
  a.length === b.length && a.every((r, i) => r.kind === b[i].kind && r.filename === b[i].filename && r.mediaMode === b[i].mediaMode && r.trimStart === b[i].trimStart && r.trimEnd === b[i].trimEnd);

/**
 * Ref-Tabs vom Server laden und Änderungen (entprellt) dorthin speichern. Beim Zurückkehren in den
 * Tab neu laden, damit Änderungen vom Handy am Laptop ankommen (und umgekehrt).
 */
export function useRefTabs() {
  const [tabs, setTabs] = useState<H3Ref[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<H3Ref[][] | null>(null);

  const save = useCallback(async () => {
    timer.current = null;
    if (!latest.current) return;
    try {
      await api("/api/ref-tabs", { method: "PUT", json: { tabs: latest.current } });
      dirty.current = false;
      setError(null);
    } catch (err) {
      setError(`Ref-Tabs nicht gespeichert: ${(err as Error).message}`);
    }
  }, []);

  const commit = useCallback(
    (next: H3Ref[][]) => {
      latest.current = next;
      setTabs(next);
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, 600);
    },
    [save],
  );

  /** Erstes Laden; gibt es noch keine Tabs, werden die bisherigen Referenzen zu Tab 1 */
  const init = useCallback(
    async (legacyRefs: H3Ref[]) => {
      try {
        const res = await api<{ tabs: H3Ref[][] | null }>("/api/ref-tabs");
        if (res.tabs?.length) {
          latest.current = res.tabs;
          setTabs(res.tabs);
        } else commit([legacyRefs ?? [], ...Array.from({ length: REF_TABS_DEFAULT - 1 }, () => [])]);
      } catch (err) {
        setError(`Ref-Tabs nicht geladen: ${(err as Error).message}`);
      }
    },
    [commit],
  );

  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState !== "visible" || dirty.current || !latest.current) return;
      try {
        const res = await api<{ tabs: H3Ref[][] | null }>("/api/ref-tabs");
        if (res.tabs?.length && !dirty.current) {
          latest.current = res.tabs;
          setTabs(res.tabs);
        }
      } catch {}
    };
    // Vor dem Schließen noch speichern
    const onHide = () => {
      if (document.visibilityState === "hidden" && timer.current) {
        clearTimeout(timer.current);
        save();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [save]);

  // Immer vom neuesten Stand ausgehen (Uploads enden asynchron, evtl. nach einem Tab-Wechsel)
  const update = (index: number, refs: H3Ref[]) => {
    const cur = latest.current;
    if (!cur) return;
    commit(cur.map((t, i) => (i === index ? refs : t)));
  };

  const addTab = (refs: H3Ref[] = []): number | null => {
    const cur = latest.current;
    if (!cur || cur.length >= REF_TABS_MAX) return null;
    commit([...cur, refs]);
    return cur.length + 1;
  };

  /** Tab 1:1 kopieren (Kopie der Liste, die Dateien selbst bleiben dieselben). to = null → neuer Tab */
  const copyTab = (from: number, to: number | null): number | null => {
    const cur = latest.current;
    const src = cur?.[from - 1];
    if (!cur || !src) return null;
    const copy = src.map((r) => ({ ...r }));
    if (to === null) return addTab(copy);
    if (!cur[to - 1] || to === from) return null;
    update(to - 1, copy);
    return to;
  };

  /**
   * Refs eines gespeicherten Jobs („nochmal“, Galerie): Tab mit gleichem Inhalt wählen, sonst in einen
   * leeren oder neuen Tab legen – nie einen bestehenden überschreiben. Rückgabe: Tab-Nummer oder null.
   */
  const placeRefs = (refs: H3Ref[]): number | null => {
    const cur = latest.current;
    if (!cur) return null;
    const same = cur.findIndex((t) => sameRefs(t, refs));
    if (same >= 0) return same + 1;
    if (!refs.length) return null;
    const empty = cur.findIndex((t) => !t.length);
    if (empty >= 0) {
      update(empty, refs);
      return empty + 1;
    }
    return addTab(refs);
  };

  return { tabs, error, init, update, addTab, copyTab, placeRefs };
}

export function RefTabsBar({
  tabs,
  active,
  onSelect,
  onAdd,
  onCopy,
}: {
  tabs: H3Ref[][];
  active: number;
  onSelect: (tab: number) => void;
  onAdd: () => void;
  /** to = null → in einen neuen Tab */
  onCopy: (to: number | null) => void;
}) {
  const [copyTo, setCopyTo] = useState("");
  const canAdd = tabs.length < REF_TABS_MAX;
  const copy = () => {
    if (!copyTo) return;
    const to = copyTo === "new" ? null : Number(copyTo);
    const target = to ? tabs[to - 1] : null;
    if (target?.length && !window.confirm(`Tab ${to} hat schon ${target.length} Referenzen. Durch Tab ${active} ersetzen?`)) return;
    onCopy(to);
    setCopyTo("");
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Ref-Tabs">
        {tabs.map((t, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={active === i + 1}
            onClick={() => onSelect(i + 1)}
            className={`min-h-10 min-w-14 rounded-lg border px-3 text-sm font-medium ${active === i + 1 ? "border-accent bg-accent text-white" : "border-line text-soft"}`}
          >
            Tab {i + 1}
            <span className={`ml-1 text-xs ${active === i + 1 ? "text-white/80" : "text-muted"}`}>{t.length || "–"}</span>
          </button>
        ))}
        {tabs.length < REF_TABS_MAX && (
          <button type="button" onClick={onAdd} className="min-h-10 rounded-lg border border-dashed border-line px-3 text-sm text-muted" aria-label="Ref-Tab hinzufügen">
            +
          </button>
        )}
      </div>
      {tabs[active - 1]?.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-soft">Tab {active} kopieren nach</span>
          <select className="input min-h-10 flex-1 py-1" value={copyTo} onChange={(e) => setCopyTo(e.target.value)} aria-label="Ziel-Tab">
            <option value="">wählen …</option>
            {tabs.map((t, i) =>
              i + 1 === active ? null : (
                <option key={i} value={i + 1}>
                  Tab {i + 1}
                  {t.length ? ` (${t.length} Refs – wird ersetzt)` : " (leer)"}
                </option>
              ),
            )}
            {canAdd && <option value="new">neuen Tab</option>}
          </select>
          <button type="button" className="btn btn-ghost min-h-10 px-3" disabled={!copyTo} onClick={copy}>
            Kopieren
          </button>
        </div>
      )}
      <p className="text-xs text-muted">
        Jeder Tab hat eigene Bilder, Videos und Audios. Im Batch wählt eine Zeile „Ref-Tab 3“ über „Clip 35“ den Tab für diesen Clip – ohne Zeile gilt der gewählte Tab.
      </p>
    </div>
  );
}
