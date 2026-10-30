"use client";

import { useState } from "react";
import { type ChecklistItem, matches, monthKey, monthLabel, newId } from "@/lib/notes";
import { Empty, ProgressLine } from "./bits";
import type { NotesApi } from "./useNotes";

/** Wiederkehrende Aufgaben – die Haken gelten pro Monat und sind am 1. automatisch wieder leer. */
export function ChecklistTab({ notes, query }: { notes: NotesApi; query: string }) {
  const [text, setText] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const month = monthKey();
  const items = notes.data.checklist.filter((c) => matches("checklist", c, query));
  const done = notes.data.checklist.filter((c) => c.doneIn.includes(month)).length;

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await notes.save("checklist", { id: newId(), createdAt: Date.now(), updatedAt: 0, text: t, doneIn: [] });
  };
  const toggle = (c: ChecklistItem) =>
    notes.save("checklist", { ...c, doneIn: c.doneIn.includes(month) ? c.doneIn.filter((m) => m !== month) : [...c.doneIn, month] });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5 px-1">
        <p className="flex items-baseline justify-between font-semibold">
          {monthLabel(month)}
          <span className="text-sm font-normal text-muted">
            {done} / {notes.data.checklist.length} erledigt
          </span>
        </p>
        <ProgressLine value={done} max={notes.data.checklist.length} />
      </div>
      {!items.length && <Empty>{query ? "Nichts gefunden." : "Noch keine Punkte. Z. B. „4 Sets posten“, „Umfrage machen“, „Customs abschließen“."}</Empty>}
      <ul className="space-y-1.5">
        {items.map((c, idx) => {
          const checked = c.doneIn.includes(month);
          if (editId === c.id)
            return (
              <li key={c.id} className="flex gap-2">
                <input className="input flex-1" value={editText} autoFocus onChange={(e) => setEditText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} onBlur={() => {
                  const t = editText.trim();
                  if (t && t !== c.text) notes.save("checklist", { ...c, text: t });
                  setEditId(null);
                }} />
                <button type="button" className="btn btn-danger px-3" aria-label="löschen" onMouseDown={(e) => e.preventDefault()} onClick={() => {
                  if (window.confirm("Punkt löschen?")) notes.remove("checklist", c.id);
                  setEditId(null);
                }}>
                  🗑
                </button>
              </li>
            );
          return (
            <li key={c.id} className="flex items-center gap-2 rounded-xl border border-line bg-bg px-3">
              <label className="flex min-h-12 flex-1 cursor-pointer items-center gap-3">
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-[var(--accent)]" checked={checked} onChange={() => toggle(c)} />
                <span className={`text-sm ${checked ? "text-muted line-through" : ""}`}>{c.text}</span>
              </label>
              {!query && (
                <>
                  <button type="button" className="h-9 w-7 text-muted disabled:opacity-20" disabled={idx === 0} aria-label="nach oben" onClick={() => notes.move("checklist", c.id, -1)}>▲</button>
                  <button type="button" className="h-9 w-7 text-muted disabled:opacity-20" disabled={idx === items.length - 1} aria-label="nach unten" onClick={() => notes.move("checklist", c.id, 1)}>▼</button>
                </>
              )}
              <button type="button" className="h-9 w-8 text-soft" aria-label="bearbeiten" onClick={() => (setEditId(c.id), setEditText(c.text))}>✎</button>
            </li>
          );
        })}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), add())}>
        <input className="input flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="Neuer Monats-Punkt …" />
        <button type="submit" className="btn btn-primary px-4" disabled={!text.trim()}>+</button>
      </form>
    </div>
  );
}
