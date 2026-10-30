"use client";

import { useState } from "react";
import { daysUntil, matches, newId, type Post, POST_STATUS, type PostStatus, shortDate } from "@/lib/notes";
import { Badge, Chips, Clamp, CopyButton, EditorFrame, Empty, KindToggle, kindLabel, Label, RowActions } from "./bits";
import type { NotesApi } from "./useNotes";

const blank = (status: PostStatus): Post => ({ id: newId(), createdAt: Date.now(), updatedAt: 0, title: "", kind: "image", status, tier: "", date: "", text: "" });

const NEXT: Record<PostStatus, { to: PostStatus; label: string } | null> = {
  unreleased: { to: "planned", label: "→ Zu posten" },
  planned: { to: "posted", label: "✓ Gepostet" },
  posted: null,
};

function PostEditor({ initial, notes, tiers, onDone }: { initial: Post; notes: NotesApi; tiers: string[]; onDone: () => void }) {
  const [p, setP] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (x: Partial<Post>) => setP((v) => ({ ...v, ...x }));
  const isNew = !initial.updatedAt;
  const listId = `tiers-${initial.id}`;
  return (
    <EditorFrame
      canSave={!!p.title.trim()}
      error={error}
      onCancel={onDone}
      onDelete={isNew ? undefined : () => (notes.remove("posts", p.id), onDone())}
      onSave={async () => {
        const res = await notes.save("posts", { ...p, title: p.title.trim(), ...(p.status === "posted" && !p.postedAt ? { postedAt: Date.now() } : {}) });
        if (res.ok) onDone();
        else setError(res.message);
      }}
    >
      <label className="block">
        <Label>Set</Label>
        <input className="input" value={p.title} onChange={(e) => set({ title: e.target.value })} placeholder="z. B. Jinx – Arcane Set" autoFocus={isNew} />
      </label>
      <KindToggle value={p.kind} onChange={(kind) => set({ kind })} />
      <div>
        <Label>Status</Label>
        <Chips value={p.status} onChange={(status) => set({ status })} options={POST_STATUS} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <Label>Tier</Label>
          <input className="input" list={listId} value={p.tier} onChange={(e) => set({ tier: e.target.value })} placeholder="Free, Tier 1 …" />
          <datalist id={listId}>
            {tiers.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <Label>Geplant am</Label>
          <input type="date" className="input" value={p.date} onChange={(e) => set({ date: e.target.value })} />
        </label>
      </div>
      <label className="block">
        <Label>Post-Text (zum Vorschreiben)</Label>
        <textarea className="input min-h-24 text-sm" value={p.text} onChange={(e) => set({ text: e.target.value })} placeholder="Titel, Beschreibung, Hashtags …" />
      </label>
    </EditorFrame>
  );
}

export function PostsTab({ notes, query, filter, setFilter }: { notes: NotesApi; query: string; filter: PostStatus; setFilter: (f: PostStatus) => void }) {
  const [editing, setEditing] = useState<Post | null>(null);
  const all = notes.data.posts.filter((p) => matches("posts", p, query));
  const count = (s: PostStatus) => all.filter((p) => p.status === s).length;
  const tiers = [...new Set(notes.data.posts.map((p) => p.tier.trim()).filter(Boolean))].sort();
  const list = all
    .filter((p) => p.status === filter)
    .sort((a, b) =>
      filter === "posted"
        ? (b.postedAt ?? b.updatedAt) - (a.postedAt ?? a.updatedAt)
        : (a.date || "9999").localeCompare(b.date || "9999") || a.createdAt - b.createdAt,
    );

  return (
    <div className="space-y-3">
      <Chips value={filter} onChange={setFilter} options={POST_STATUS.map((s) => ({ value: s.value, label: `${s.label} (${count(s.value)})` }))} />
      {editing && !editing.updatedAt ? (
        <PostEditor initial={editing} notes={notes} tiers={tiers} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="btn btn-primary w-full" onClick={() => setEditing(blank(filter === "posted" ? "unreleased" : filter))}>
          + Set hinzufügen
        </button>
      )}
      {!list.length && <Empty>{query ? "Nichts gefunden." : filter === "unreleased" ? "Keine unveröffentlichten Sets." : filter === "planned" ? "Nichts geplant." : "Noch nichts gepostet."}</Empty>}
      {list.map((p) => {
        if (editing?.id === p.id) return <PostEditor key={p.id} initial={editing} notes={notes} tiers={tiers} onDone={() => setEditing(null)} />;
        const next = NEXT[p.status];
        const d = daysUntil(p.date);
        return (
          <div key={p.id} className="space-y-2 rounded-xl border border-line bg-bg p-3">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 font-semibold leading-snug">{p.title}</p>
              <RowActions onEdit={() => setEditing(p)} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={p.kind === "video" ? "accent" : "muted"}>{kindLabel(p.kind)}</Badge>
              {p.tier && <Badge>{p.tier}</Badge>}
              {p.date && p.status !== "posted" && <Badge tone={d !== null && d < 0 ? "red" : d === 0 ? "amber" : "muted"}>📅 {shortDate(p.date)}</Badge>}
              {p.status === "posted" && p.postedAt && <Badge tone="green">gepostet {new Date(p.postedAt).toLocaleDateString("de-DE")}</Badge>}
            </div>
            <Clamp text={p.text} lines={2} />
            <div className="flex flex-wrap gap-2">
              {next && (
                <button
                  type="button"
                  className="btn btn-ghost min-h-9 flex-1 px-3 text-sm"
                  onClick={() => notes.save("posts", { ...p, status: next.to, ...(next.to === "posted" ? { postedAt: Date.now() } : {}) })}
                >
                  {next.label}
                </button>
              )}
              {p.text.trim() && <CopyButton text={p.text} label="📋 Text" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
