"use client";

import { useState } from "react";
import { matches, newId, type Snippet } from "@/lib/notes";
import { Clamp, CopyButton, EditorFrame, Empty, Label, RowActions } from "./bits";
import type { NotesApi } from "./useNotes";

const blank = (): Snippet => ({ id: newId(), createdAt: Date.now(), updatedAt: 0, title: "", body: "" });

function SnippetEditor({ initial, notes, onDone }: { initial: Snippet; notes: NotesApi; onDone: () => void }) {
  const [s, setS] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const isNew = !initial.updatedAt;
  return (
    <EditorFrame
      canSave={!!s.body.trim()}
      error={error}
      onCancel={onDone}
      onDelete={isNew ? undefined : () => (notes.remove("snippets", s.id), onDone())}
      onSave={async () => {
        const res = await notes.save("snippets", { ...s, title: s.title.trim() });
        if (res.ok) onDone();
        else setError(res.message);
      }}
    >
      <label className="block">
        <Label>Titel</Label>
        <input className="input" value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} placeholder="z. B. Server updaten" autoFocus={isNew} />
      </label>
      <label className="block">
        <Label>Inhalt (Befehl, Prompt, Antwort-Text …)</Label>
        <textarea
          className="input min-h-28 font-mono text-[13px]"
          value={s.body}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => setS({ ...s, body: e.target.value })}
        />
      </label>
    </EditorFrame>
  );
}

/** Befehle & Schnipsel – ein Tipp kopiert. */
export function SnippetsTab({ notes, query }: { notes: NotesApi; query: string }) {
  const [editing, setEditing] = useState<Snippet | null>(null);
  const list = notes.data.snippets.filter((s) => matches("snippets", s, query));
  return (
    <div className="space-y-3">
      {editing && !editing.updatedAt ? (
        <SnippetEditor initial={editing} notes={notes} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="btn btn-primary w-full" onClick={() => setEditing(blank())}>
          + Befehl / Schnipsel
        </button>
      )}
      {!list.length && <Empty>{query ? "Nichts gefunden." : "Hier kommen Befehle, Standard-Prompts und Antwort-Texte hin – mit Kopier-Knopf."}</Empty>}
      {list.map((s, idx) =>
        editing?.id === s.id ? (
          <SnippetEditor key={s.id} initial={editing} notes={notes} onDone={() => setEditing(null)} />
        ) : (
          <div key={s.id} className="space-y-2 rounded-xl border border-line bg-bg p-3">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate font-semibold">{s.title || "Ohne Titel"}</p>
              <RowActions
                onUp={!query && idx > 0 ? () => notes.move("snippets", s.id, -1) : undefined}
                onDown={!query && idx < list.length - 1 ? () => notes.move("snippets", s.id, 1) : undefined}
                onEdit={() => setEditing(s)}
              />
            </div>
            <Clamp text={s.body} lines={4} mono />
            <CopyButton text={s.body} className="w-full" />
          </div>
        ),
      )}
    </div>
  );
}
