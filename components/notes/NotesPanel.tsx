"use client";

import { useEffect, useState } from "react";
import { loadLocal, saveLocal } from "@/lib/client";
import { type CollectionName, matches, monthKey, PAD_ID, type PostStatus } from "@/lib/notes";
import { CharactersTab } from "./Characters";
import { ChecklistTab } from "./Checklist";
import { IdeasTab } from "./Ideas";
import { OrdersTab, SendTab } from "./Orders";
import { PadTab } from "./Pad";
import { PostsTab } from "./Posts";
import { SnippetsTab } from "./Snippets";
import { useNotes } from "./useNotes";

type Tab = "orders" | "send" | "posts" | "ideas" | "characters" | "month" | "snippets" | "pad";

const TABS: { id: Tab; label: string; col: CollectionName }[] = [
  { id: "orders", label: "Aufträge", col: "orders" },
  { id: "send", label: "Schicken", col: "orders" },
  { id: "posts", label: "Posten", col: "posts" },
  { id: "ideas", label: "Ideen", col: "ideas" },
  { id: "characters", label: "Charaktere", col: "characters" },
  { id: "month", label: "Monat", col: "checklist" },
  { id: "snippets", label: "Befehle", col: "snippets" },
  { id: "pad", label: "Notiz", col: "pad" },
];

const TAB_KEY = "pf.notes.tab";

/** Komplette Notizen-Ansicht – in der Seitenleiste am Mac und als eigene Seite am Handy. */
export function NotesPanel({ compact = false }: { compact?: boolean }) {
  const notes = useNotes();
  const [tab, setTab] = useState<Tab>("orders");
  const [query, setQuery] = useState("");
  const [postFilter, setPostFilter] = useState<PostStatus>("planned");

  useEffect(() => setTab(loadLocal<{ tab: Tab }>(TAB_KEY, { tab: "orders" }).tab), []);
  const choose = (t: Tab) => {
    setTab(t);
    saveLocal(TAB_KEY, { tab: t });
  };

  const { orders, posts, checklist } = notes.data;
  const counts = {
    open: orders.filter((o) => o.status === "open" || o.status === "progress").length,
    tosend: orders.filter((o) => o.status === "tosend").length,
    unreleased: posts.filter((p) => p.status === "unreleased").length,
    planned: posts.filter((p) => p.status === "planned").length,
    monthLeft: checklist.filter((c) => !c.doneIn.includes(monthKey())).length,
  };

  // Treffer pro Tab während der Suche
  const hits = (t: (typeof TABS)[number]) => {
    const list = notes.data[t.col] as { id: string }[];
    const found = list.filter((x) => matches(t.col, x as never, query));
    if (t.id === "send") return found.filter((o) => (o as unknown as { status: string }).status === "tosend").length;
    return found.length;
  };

  const Stat = ({ n, label, to, warn, post }: { n: number; label: string; to: Tab; warn?: boolean; post?: PostStatus }) => (
    <button
      type="button"
      onClick={() => (choose(to), post && setPostFilter(post))}
      className={`rounded-xl border px-2 py-1.5 text-left ${tab === to && (!post || post === postFilter) ? "border-accent" : "border-line"} bg-bg`}
    >
      <span className={`block text-lg font-semibold leading-tight ${warn && n > 0 ? "text-amber-200" : ""}`}>{n}</span>
      <span className="block text-[11px] leading-tight text-muted">{label}</span>
    </button>
  );

  const q = query.trim();
  const padHit = q && notes.data.pad.some((p) => p.id === PAD_ID && matches("pad", p, q));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1.5">
        <Stat n={counts.open} label="offen" to="orders" />
        <Stat n={counts.tosend} label="zu schicken" to="send" warn />
        <Stat n={counts.unreleased} label="unreleased" to="posts" post="unreleased" />
        <Stat n={counts.planned} label="zu posten" to="posts" post="planned" />
      </div>

      <div className="relative">
        <input className="input pr-10 text-sm" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Suchen (Person, Charakter, Text …)" />
        {query && (
          <button type="button" className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 text-muted" aria-label="Suche leeren" onClick={() => setQuery("")}>
            ✕
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const n = q ? hits(t) : t.id === "month" ? counts.monthLeft : null;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => choose(t.id)}
              className={`min-h-9 shrink-0 rounded-full border px-3 text-sm font-medium transition ${tab === t.id ? "border-accent bg-accent text-white" : "border-line text-soft"} ${q && !n && t.id !== "pad" ? "opacity-40" : ""}`}
            >
              {t.label}
              {n ? <span className="ml-1 text-xs opacity-80">{n}</span> : null}
              {t.id === "pad" && padHit ? <span className="ml-1 text-xs">•</span> : null}
            </button>
          );
        })}
      </div>

      {notes.error && !notes.loaded && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          Notizen konnten nicht geladen werden: {notes.error}{" "}
          <button type="button" className="underline" onClick={notes.reload}>
            nochmal
          </button>
        </p>
      )}

      {!notes.loaded && !notes.error ? (
        <p className="py-6 text-center text-sm text-muted">Lade …</p>
      ) : (
        <>
          {tab === "orders" && <OrdersTab notes={notes} query={q} />}
          {tab === "send" && <SendTab notes={notes} query={q} />}
          {tab === "posts" && <PostsTab notes={notes} query={q} filter={postFilter} setFilter={setPostFilter} />}
          {tab === "ideas" && <IdeasTab notes={notes} query={q} />}
          {tab === "characters" && <CharactersTab notes={notes} query={q} />}
          {tab === "month" && <ChecklistTab notes={notes} query={q} />}
          {tab === "snippets" && <SnippetsTab notes={notes} query={q} />}
          {tab === "pad" && notes.loaded && <PadTab notes={notes} tall={!compact} />}
        </>
      )}
    </div>
  );
}
