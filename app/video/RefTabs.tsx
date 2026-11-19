"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { EXTRA_TAB, REF_TABS_DEFAULT, REF_TABS_MAX, refTabShort } from "@/lib/h3refs";
import type { H3Ref } from "@/lib/types";

export const emptyTabs = (): H3Ref[][] => Array.from({ length: REF_TABS_DEFAULT }, () => []);

interface TabsState {
  tabs: H3Ref[][];
  /** „Tab Extra“ (Nummer 0) – entsteht bei „Einstellungen übernehmen“ und wird dort jedes Mal ersetzt */
  extra: H3Ref[] | null;
  /** zuletzt geladene/gespeicherte Tab-Gruppe */
  group: string | null;
}

interface TabsResponse {
  tabs: H3Ref[][] | null;
  extra?: H3Ref[] | null;
  group?: string | null;
}

/**
 * Ref-Tabs vom Server laden und Änderungen (entprellt) dorthin speichern. Beim Zurückkehren in den
 * Tab neu laden, damit Änderungen vom Handy am Laptop ankommen (und umgekehrt).
 * Tab-Nummern: 1…N = normale Tabs, 0 = Tab Extra.
 */
export function useRefTabs() {
  const [state, setState] = useState<TabsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<TabsState | null>(null);

  const save = useCallback(async () => {
    timer.current = null;
    if (!latest.current) return;
    try {
      await api("/api/ref-tabs", { method: "PUT", json: latest.current });
      dirty.current = false;
      setError(null);
    } catch (err) {
      setError(`Ref-Tabs nicht gespeichert: ${(err as Error).message}`);
    }
  }, []);

  const commit = useCallback(
    (next: TabsState) => {
      latest.current = next;
      setState(next);
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, 600);
    },
    [save],
  );

  const apply = (res: TabsResponse) => {
    const next = { tabs: res.tabs!, extra: res.extra ?? null, group: res.group ?? null };
    latest.current = next;
    setState(next);
  };

  /** Erstes Laden; gibt es noch keine Tabs, werden die bisherigen Referenzen zu Tab 1 */
  const init = useCallback(
    async (legacyRefs: H3Ref[]) => {
      try {
        const res = await api<TabsResponse>("/api/ref-tabs");
        if (res.tabs?.length) apply(res);
        else commit({ tabs: [legacyRefs ?? [], ...emptyTabs().slice(1)], extra: null, group: null });
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
        const res = await api<TabsResponse>("/api/ref-tabs");
        if (res.tabs?.length && !dirty.current) apply(res);
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
  const get = (tab: number): H3Ref[] | null => {
    const cur = latest.current;
    if (!cur) return null;
    return tab === EXTRA_TAB ? cur.extra : (cur.tabs[tab - 1] ?? null);
  };

  const update = (tab: number, refs: H3Ref[]) => {
    const cur = latest.current;
    if (!cur) return;
    if (tab === EXTRA_TAB) commit({ ...cur, extra: refs });
    else commit({ ...cur, tabs: cur.tabs.map((t, i) => (i === tab - 1 ? refs : t)) });
  };

  const addTab = (refs: H3Ref[] = []): number | null => {
    const cur = latest.current;
    if (!cur || cur.tabs.length >= REF_TABS_MAX) return null;
    commit({ ...cur, tabs: [...cur.tabs, refs] });
    return cur.tabs.length + 1;
  };

  /** Tab 1:1 kopieren (Kopie der Liste, die Dateien selbst bleiben dieselben). to = null → neuer Tab */
  const copyTab = (from: number, to: number | null): number | null => {
    const src = get(from);
    if (!src) return null;
    const copy = src.map((r) => ({ ...r }));
    if (to === null) return addTab(copy);
    if (to === from || to === EXTRA_TAB || !get(to)) return null;
    update(to, copy);
    return to;
  };

  /** „Einstellungen übernehmen“: Refs des Jobs in Tab Extra (ersetzt den alten Inhalt) */
  const setExtra = (refs: H3Ref[]) => {
    const cur = latest.current;
    if (cur) commit({ ...cur, extra: refs.map((r) => ({ ...r })) });
  };

  /** Tab-Gruppe laden bzw. leere Tabs: alle Tabs ersetzen (Tab Extra bleibt) */
  const replaceAll = (tabs: H3Ref[][], group: string | null) => {
    const cur = latest.current;
    if (cur) commit({ ...cur, tabs: tabs.map((t) => t.map((r) => ({ ...r }))), group });
  };

  const setGroupName = (group: string | null) => {
    const cur = latest.current;
    if (cur) commit({ ...cur, group });
  };

  const closeExtra = () => {
    const cur = latest.current;
    if (cur) commit({ ...cur, extra: null });
  };

  return {
    tabs: state?.tabs ?? null,
    extra: state?.extra ?? null,
    group: state?.group ?? null,
    error,
    init,
    update,
    addTab,
    copyTab,
    setExtra,
    closeExtra,
    replaceAll,
    setGroupName,
  };
}

export function RefTabsBar({
  tabs,
  extra,
  active,
  onSelect,
  onAdd,
  onCopy,
  onCloseExtra,
}: {
  tabs: H3Ref[][];
  extra: H3Ref[] | null;
  /** 1…N oder 0 = Tab Extra */
  active: number;
  onSelect: (tab: number) => void;
  onAdd: () => void;
  /** to = null → in einen neuen Tab */
  onCopy: (to: number | null) => void;
  onCloseExtra: () => void;
}) {
  const [copyTo, setCopyTo] = useState("");
  const canAdd = tabs.length < REF_TABS_MAX;
  const activeRefs = active === EXTRA_TAB ? extra : tabs[active - 1];
  const copy = () => {
    if (!copyTo) return;
    const to = copyTo === "new" ? null : Number(copyTo);
    const target = to ? tabs[to - 1] : null;
    if (target?.length && !window.confirm(`Tab ${to} hat schon ${target.length} Referenzen. Durch ${refTabShort(active)} ersetzen?`)) return;
    onCopy(to);
    setCopyTo("");
  };
  const tabClass = (on: boolean) => `min-h-10 min-w-14 rounded-lg border px-3 text-sm font-medium ${on ? "border-accent bg-accent text-white" : "border-line text-soft"}`;
  const count = (on: boolean, n: number) => <span className={`ml-1 text-xs ${on ? "text-white/80" : "text-muted"}`}>{n || "–"}</span>;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Ref-Tabs">
        {tabs.map((t, i) => (
          <button key={i} type="button" role="tab" aria-selected={active === i + 1} onClick={() => onSelect(i + 1)} className={tabClass(active === i + 1)}>
            Tab {i + 1}
            {count(active === i + 1, t.length)}
          </button>
        ))}
        {canAdd && (
          <button type="button" onClick={onAdd} className="min-h-10 rounded-lg border border-dashed border-line px-3 text-sm text-muted" aria-label="Ref-Tab hinzufügen">
            +
          </button>
        )}
        {extra && (
          <span className="flex">
            <button
              type="button"
              role="tab"
              aria-selected={active === EXTRA_TAB}
              onClick={() => onSelect(EXTRA_TAB)}
              className={`${tabClass(active === EXTRA_TAB)} rounded-r-none border-dashed`}
              title="Refs aus „Einstellungen übernehmen“ – wird beim nächsten Übernehmen ersetzt"
            >
              Tab Extra
              {count(active === EXTRA_TAB, extra.length)}
            </button>
            <button
              type="button"
              onClick={onCloseExtra}
              className="min-h-10 rounded-r-lg border border-l-0 border-dashed border-line px-2.5 text-sm text-muted"
              aria-label="Tab Extra schließen"
            >
              ✕
            </button>
          </span>
        )}
      </div>
      {(activeRefs?.length ?? 0) > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-soft">{active === EXTRA_TAB ? "Tab Extra" : refTabShort(active)} kopieren nach</span>
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
        {active === EXTRA_TAB
          ? "Tab Extra enthält die Referenzen aus „Einstellungen übernehmen“ und wird beim nächsten Übernehmen ersetzt. Zum Behalten in einen normalen Tab kopieren."
          : "Jeder Tab hat eigene Bilder, Videos und Audios. Im Batch wählt eine Zeile „Ref-Tab 3“ über „Clip 35“ den Tab für diesen Clip – ohne Zeile gilt der gewählte Tab."}
      </p>
    </div>
  );
}
