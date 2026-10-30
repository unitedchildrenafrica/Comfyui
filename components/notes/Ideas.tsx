"use client";

import { useState } from "react";
import { IDEA_STATUS, type Idea, matches, newId } from "@/lib/notes";
import { Badge, Chips, Clamp, EditorFrame, Empty, Label, RowActions } from "./bits";
import type { NotesApi } from "./useNotes";

const blank = (): Idea => ({ id: newId(), createdAt: Date.now(), updatedAt: 0, title: "", from: "", votes: 1, status: "idea", note: "" });

function IdeaEditor({ initial, notes, onDone }: { initial: Idea; notes: NotesApi; onDone: () => void }) {
  const [i, setI] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (x: Partial<Idea>) => setI((v) => ({ ...v, ...x }));
  const isNew = !initial.updatedAt;
  return (
    <EditorFrame
      canSave={!!i.title.trim()}
      error={error}
      onCancel={onDone}
      onDelete={isNew ? undefined : () => (notes.remove("ideas", i.id), onDone())}
      onSave={async () => {
        const res = await notes.save("ideas", { ...i, title: i.title.trim() });
        if (res.ok) onDone();
        else setError(res.message);
      }}
    >
      <label className="block">
        <Label>Charakter / Idee</Label>
        <input className="input" value={i.title} onChange={(e) => set({ title: e.target.value })} placeholder="z. B. Makima (Chainsaw Man)" autoFocus={isNew} />
      </label>
      <label className="block">
        <Label>Gewünscht von (leer = eigene Idee)</Label>
        <input className="input" value={i.from} onChange={(e) => set({ from: e.target.value })} placeholder="Namen, mit Komma getrennt" />
      </label>
      <div>
        <Label>Status</Label>
        <Chips value={i.status} onChange={(status) => set({ status })} options={IDEA_STATUS} />
      </div>
      <label className="block">
        <Label>Notiz</Label>
        <textarea className="input min-h-20 text-sm" value={i.note} onChange={(e) => set({ note: e.target.value })} placeholder="Outfit, Szene, Referenz-Links …" />
      </label>
    </EditorFrame>
  );
}

export function IdeasTab({ notes, query }: { notes: NotesApi; query: string }) {
  const [editing, setEditing] = useState<Idea | null>(null);
  const [showDone, setShowDone] = useState(false);
  const all = notes.data.ideas.filter((i) => matches("ideas", i, query));
  const sorted = [...all].sort((a, b) => (a.status === "planned" ? 0 : 1) - (b.status === "planned" ? 0 : 1) || b.votes - a.votes || a.createdAt - b.createdAt);
  const open = sorted.filter((i) => i.status !== "done");
  const done = sorted.filter((i) => i.status === "done");

  const render = (i: Idea) =>
    editing?.id === i.id ? (
      <IdeaEditor key={i.id} initial={editing} notes={notes} onDone={() => setEditing(null)} />
    ) : (
      <div key={i.id} className={`flex items-start gap-3 rounded-xl border border-line bg-bg p-3 ${i.status === "done" ? "opacity-60" : ""}`}>
        <button
          type="button"
          className="flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-lg border border-line text-soft"
          aria-label="Stimme dazu"
          onClick={() => notes.save("ideas", { ...i, votes: i.votes + 1 })}
        >
          <span className="text-xs leading-none">▲</span>
          <span className="font-semibold">{i.votes}</span>
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold leading-snug">{i.title}</p>
          <div className="flex flex-wrap gap-1.5">
            {i.status === "planned" && <Badge tone="accent">Geplant</Badge>}
            {i.status === "done" && <Badge tone="green">Erledigt</Badge>}
            {i.from ? <Badge>von {i.from}</Badge> : <Badge>eigene Idee</Badge>}
          </div>
          <Clamp text={i.note} lines={2} />
        </div>
        <RowActions onEdit={() => setEditing(i)} />
      </div>
    );

  return (
    <div className="space-y-3">
      {editing && !editing.updatedAt ? (
        <IdeaEditor initial={editing} notes={notes} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="btn btn-primary w-full" onClick={() => setEditing(blank())}>
          + Idee / Wunsch
        </button>
      )}
      <p className="px-1 text-xs text-muted">▲ zählt Wünsche hoch – oben stehen die gefragtesten (gut für Patreon-Umfragen).</p>
      {!open.length && <Empty>{query ? "Nichts gefunden." : "Noch keine Ideen."}</Empty>}
      {open.map(render)}
      {done.length > 0 && (
        <button type="button" className="w-full py-2 text-sm text-muted underline" onClick={() => setShowDone(!showDone)}>
          {showDone ? "Erledigte ausblenden" : `Erledigte anzeigen (${done.length})`}
        </button>
      )}
      {showDone && done.map(render)}
    </div>
  );
}
