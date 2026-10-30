"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { type Pad, PAD_ID } from "@/lib/notes";
import type { NotesApi } from "./useNotes";

type State = "saved" | "dirty" | "saving" | "conflict" | "error";

/**
 * Freie Notiz wie die bisherige Notizenseite. Speichert automatisch kurz nach dem Tippen.
 * Wurde sie auf einem anderen Gerät geändert, wird nichts überschrieben, sondern gefragt.
 */
export function PadTab({ notes, tall }: { notes: NotesApi; tall?: boolean }) {
  const server = notes.data.pad.find((p) => p.id === PAD_ID) ?? null;
  const [text, setText] = useState(server?.text ?? "");
  const [state, setState] = useState<State>("saved");
  const [conflict, setConflict] = useState<Pad | null>(null);
  const base = useRef<number>(server?.updatedAt ?? 0);
  const textRef = useRef(text);
  textRef.current = text;
  const stateRef = useRef(state);
  stateRef.current = state;

  // Neuer Stand vom Server (anderes Gerät) übernehmen, solange hier nichts ungespeichert ist
  useEffect(() => {
    if (!server || server.updatedAt <= base.current) return;
    if (stateRef.current === "saved") {
      base.current = server.updatedAt;
      setText(server.text);
    }
  }, [server]);

  const save = async (force = false) => {
    setState("saving");
    const sent = textRef.current;
    try {
      const res = await api<{ item: Pad }>(`/api/notes/pad`, {
        method: "PUT",
        json: { item: { id: PAD_ID, text: sent, createdAt: server?.createdAt ?? Date.now() }, baseUpdatedAt: base.current, force },
      });
      base.current = res.item.updatedAt;
      setConflict(null);
      setState(textRef.current === sent ? "saved" : "dirty");
    } catch (err) {
      const e = err as ApiError;
      if (e.data?.code === "conflict") {
        setConflict(e.data.current as Pad);
        setState("conflict");
      } else setState("error");
    }
  };

  // 800 ms nach dem letzten Tastendruck speichern
  useEffect(() => {
    if (state !== "dirty") return;
    const t = setTimeout(() => save(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, state]);

  // Beim Verlassen der Seite nichts verlieren
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (stateRef.current === "dirty" || stateRef.current === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const label = { saved: "✓ gespeichert", dirty: "…", saving: "speichert …", conflict: "Konflikt", error: "⚠ nicht gespeichert" }[state];

  return (
    <div className="space-y-2">
      {conflict && (
        <div className="space-y-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-100">
          <p>Die Notiz wurde inzwischen auf einem anderen Gerät geändert.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-ghost min-h-9 flex-1 text-sm"
              onClick={() => {
                base.current = conflict.updatedAt;
                setText(conflict.text);
                setConflict(null);
                setState("saved");
              }}
            >
              Andere Version laden
            </button>
            <button type="button" className="btn btn-ghost min-h-9 flex-1 text-sm" onClick={() => save(true)}>
              Meine behalten
            </button>
          </div>
        </div>
      )}
      <textarea
        className={`input w-full resize-y text-sm leading-relaxed ${tall ? "min-h-[calc(100dvh-16rem)]" : "min-h-[60vh]"}`}
        value={text}
        placeholder="Alles, was sonst nirgends reinpasst. Deine bisherige Notizenseite kannst du hier einfach komplett reinkopieren."
        onChange={(e) => {
          setText(e.target.value);
          if (stateRef.current !== "conflict") setState("dirty");
        }}
        onBlur={() => stateRef.current === "dirty" && save()}
      />
      <p className={`text-right text-xs ${state === "error" || state === "conflict" ? "text-amber-200" : "text-muted"}`}>
        {label}
        {state === "error" && (
          <button type="button" className="ml-2 text-accent underline" onClick={() => save()}>
            nochmal
          </button>
        )}
      </p>
    </div>
  );
}
