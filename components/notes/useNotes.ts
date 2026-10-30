"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { COLLECTIONS, type CollectionName, type NoteCollections } from "@/lib/notes";

export type NotesData = { [C in CollectionName]: NoteCollections[C][] };

const EMPTY: NotesData = { orders: [], posts: [], ideas: [], snippets: [], checklist: [], characters: [], pad: [] };
/** Andere offene Notiz-Ansichten (Seitenleiste + Seite) nach eigener Änderung auffrischen */
const CHANGED = "pf:notes-changed";
const POLL_MS = 20_000;

export type SaveResult = { ok: true } | { ok: false; conflict: boolean; message: string };

/**
 * Alle Notiz-Listen laden und synchron halten: alle 20 s, beim Zurückkehren in den Tab und
 * nach Änderungen in einer anderen Ansicht. Speichern ist optimistisch (sofort sichtbar).
 */
export function useNotes() {
  const [data, setData] = useState<NotesData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const source = useRef(Math.random().toString(36));

  const load = useCallback(async () => {
    try {
      const lists = await Promise.all(COLLECTIONS.map((c) => api<{ items: unknown[] }>(`/api/notes/${c}`)));
      setData(Object.fromEntries(COLLECTIONS.map((c, i) => [c, lists[i].items])) as NotesData);
      setError(null);
      setLoaded(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    const onChanged = (e: Event) => (e as CustomEvent).detail !== source.current && load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", load);
    window.addEventListener(CHANGED, onChanged);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", load);
      window.removeEventListener(CHANGED, onChanged);
    };
  }, [load]);

  const announce = () => window.dispatchEvent(new CustomEvent(CHANGED, { detail: source.current }));

  const replaceLocal = <C extends CollectionName>(col: C, item: NoteCollections[C]) =>
    setData((d) => {
      const list = d[col] as NoteCollections[C][];
      const i = list.findIndex((x) => x.id === item.id);
      const next = i >= 0 ? list.map((x, j) => (j === i ? item : x)) : [...list, item];
      return { ...d, [col]: next };
    });

  const save = useCallback(async <C extends CollectionName>(col: C, item: NoteCollections[C], opts: { force?: boolean } = {}): Promise<SaveResult> => {
    const before = (dataRef.current[col] as NoteCollections[C][]).find((x) => x.id === item.id);
    replaceLocal(col, item);
    try {
      const res = await api<{ item: NoteCollections[C] }>(`/api/notes/${col}`, {
        method: "PUT",
        json: { item, baseUpdatedAt: before?.updatedAt, force: opts.force },
      });
      replaceLocal(col, res.item);
      announce();
      return { ok: true };
    } catch (err) {
      const e = err as ApiError;
      if (e.data?.code === "conflict" && e.data.current) {
        replaceLocal(col, e.data.current as NoteCollections[C]);
        return { ok: false, conflict: true, message: "Wurde inzwischen auf einem anderen Gerät geändert – der neue Stand ist geladen." };
      }
      if (before) replaceLocal(col, before);
      else setData((d) => ({ ...d, [col]: (d[col] as { id: string }[]).filter((x) => x.id !== item.id) }));
      return { ok: false, conflict: false, message: e.message };
    }
  }, []);

  const remove = useCallback(async (col: CollectionName, id: string) => {
    setData((d) => ({ ...d, [col]: (d[col] as { id: string }[]).filter((x) => x.id !== id) }));
    try {
      await api(`/api/notes/${col}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      announce();
    } catch {
      load();
    }
  }, [load]);

  /** Eintrag um eine Position nach oben (-1) oder unten (+1) schieben */
  const move = useCallback(async (col: CollectionName, id: string, dir: -1 | 1) => {
    const list = [...(dataRef.current[col] as { id: string }[])];
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setData((d) => ({ ...d, [col]: list }));
    try {
      await api(`/api/notes/${col}`, { method: "PUT", json: { order: list.map((x) => x.id) } });
      announce();
    } catch {
      load();
    }
  }, [load]);

  return { data, loaded, error, reload: load, save, remove, move };
}

export type NotesApi = ReturnType<typeof useNotes>;

/** In die Zwischenablage kopieren – mit Rückfall für ältere Browser */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
