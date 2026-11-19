"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { H3Ref } from "@/lib/types";

interface Group {
  id: string;
  name: string;
  tabs: H3Ref[][];
  savedAt: number;
}

const sig = (tabs: H3Ref[][]) => JSON.stringify(tabs.map((t) => t.map((r) => [r.kind, r.filename, r.mediaMode ?? "", r.trimStart ?? "", r.trimEnd ?? ""])));
const refCount = (tabs: H3Ref[][]) => tabs.reduce((n, t) => n + t.length, 0);
const when = (ms: number) => new Date(ms).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });

/**
 * Tab-Gruppen: alle Ref-Tabs unter einem Namen speichern und später wieder laden.
 * Gespeichert wird auf dem Server (Handy und Laptop sehen dieselben Gruppen).
 */
export function TabGroups({
  tabs,
  group,
  extraCount,
  onLoad,
  onSaved,
  onClearAll,
}: {
  tabs: H3Ref[][];
  group: string | null;
  /** Anzahl Refs in Tab Extra (wird beim Leeren mit entfernt) */
  extraCount: number;
  /** alle aktuellen Tabs leeren (inkl. Tab Extra) – Gruppen bleiben */
  onClearAll: () => void;
  /** Tabs ersetzen; name = null → leere Tabs ohne Gruppe */
  onLoad: (tabs: H3Ref[][], name: string | null) => void;
  onSaved: (name: string) => void;
}) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setGroups((await api<{ groups: Group[] }>("/api/ref-tab-groups")).groups);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const current = groups?.find((g) => g.name.toLowerCase() === (group ?? "").toLowerCase()) ?? null;
  const hasRefs = refCount(tabs) > 0;
  // „geändert“: weicht vom gespeicherten Stand der geladenen Gruppe ab (ohne Gruppe: sobald etwas drin ist)
  const unsaved = groups !== null && (current ? sig(current.tabs) !== sig(tabs) : hasRefs);

  const save = async () => {
    const name = window.prompt("Name der Tab-Gruppe (z. B. „Strand-Video“):", current?.name ?? "")?.trim();
    if (!name) return;
    const other = groups?.find((g) => g.name.toLowerCase() === name.toLowerCase());
    if (other && other !== current && !window.confirm(`Es gibt schon eine Gruppe „${other.name}“. Überschreiben?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ group: Group; groups: Group[] }>("/api/ref-tab-groups", { method: "POST", json: { name, tabs } });
      setGroups(res.groups);
      onSaved(res.group.name);
      setNote(`Gespeichert als „${res.group.name}“.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmReplace = (what: string) =>
    !unsaved || !hasRefs || window.confirm(`Deine aktuellen Tabs${current ? ` (Änderungen an „${current.name}“)` : ""} sind nicht gespeichert und werden durch ${what} ersetzt. Trotzdem fortfahren?`);

  const loadGroup = (g: Group) => {
    if (!confirmReplace(`„${g.name}“`)) return;
    onLoad(g.tabs, g.name);
    setNote(`„${g.name}“ geladen.`);
    setOpen(false);
  };

  const clearAll = () => {
    const total = refCount(tabs) + extraCount;
    const warn = unsaved && hasRefs ? "\n\nAchtung: Die aktuellen Tabs sind nicht als Gruppe gespeichert – vorher „💾 Speichern“, wenn du sie behalten willst." : "";
    if (!window.confirm(`Alle ${total} Referenzen aus Tab 1–${tabs.length}${extraCount ? " und Tab Extra" : ""} entfernen? Gespeicherte Gruppen bleiben erhalten.${warn}`)) return;
    onClearAll();
    setNote("Alle Tabs geleert – gespeicherte Gruppen sind unverändert.");
    setOpen(false);
  };

  const fresh = () => {
    if (!confirmReplace("leere Tabs")) return;
    onLoad([], null);
    setNote("Neue leere Tabs – deine gespeicherten Gruppen bleiben erhalten.");
    setOpen(false);
  };

  const remove = async (g: Group) => {
    if (!window.confirm(`Tab-Gruppe „${g.name}“ löschen? Die Dateien selbst bleiben erhalten.`)) return;
    try {
      setGroups((await api<{ groups: Group[] }>(`/api/ref-tab-groups?id=${encodeURIComponent(g.id)}`, { method: "DELETE" })).groups);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-line bg-bg p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="w-full truncate px-1 text-sm">
          <span className="text-muted">Gruppe: </span>
          <span className="font-medium">{group ?? "nicht gespeichert"}</span>
          {group && unsaved && <span className="text-amber-200"> · geändert</span>}
        </p>
        <button type="button" className="btn btn-ghost min-h-10 flex-1 whitespace-nowrap px-2 text-[13px]" disabled={busy || !hasRefs} onClick={save}>
          💾 Speichern
        </button>
        <button type="button" className="btn btn-ghost min-h-10 flex-1 whitespace-nowrap px-2 text-[13px]" aria-expanded={open} onClick={() => setOpen(!open)}>
          📂 Gruppen{groups?.length ? ` ${groups.length}` : ""}
        </button>
        <button
          type="button"
          className="btn btn-ghost min-h-10 flex-1 whitespace-nowrap px-2 text-[13px] text-red-300"
          disabled={!hasRefs && !extraCount}
          onClick={clearAll}
        >
          🧹 Leeren
        </button>
      </div>
      {open && (
        <div className="space-y-1.5">
          <button type="button" className="btn btn-ghost min-h-10 w-full text-sm" onClick={fresh}>
            ＋ Neue leere Tabs
          </button>
          {!groups?.length && <p className="px-1 text-xs text-muted">Noch keine Gruppen gespeichert.</p>}
          {groups?.map((g) => (
            <div key={g.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${g === current ? "border-accent" : "border-line"}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{g.name}</span>
                <span className="block text-xs text-muted">
                  {g.tabs.length} Tabs · {refCount(g.tabs)} Refs · {when(g.savedAt)}
                </span>
              </span>
              <button type="button" className="btn btn-primary min-h-9 px-3 text-sm" onClick={() => loadGroup(g)}>
                Laden
              </button>
              <button type="button" className="btn btn-ghost min-h-9 px-2.5 text-sm" aria-label={`„${g.name}“ löschen`} onClick={() => remove(g)}>
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
      {note && <p className="px-1 text-xs text-muted">{note}</p>}
      {error && <p className="px-1 text-xs text-red-300">{error}</p>}
    </div>
  );
}
