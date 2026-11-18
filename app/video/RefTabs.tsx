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

  return { tabs, error, init, update, addTab, placeRefs };
}

export function RefTabsBar({ tabs, active, onSelect, onAdd }: { tabs: H3Ref[][]; active: number; onSelect: (tab: number) => void; onAdd: () => void }) {
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
      <p className="text-xs text-muted">
        Jeder Tab hat eigene Bilder, Videos und Audios. Im Batch wählt eine Zeile „Ref-Tab 3“ über „Clip 35“ den Tab für diesen Clip – ohne Zeile gilt der gewählte Tab.
      </p>
    </div>
  );
}
