"use client";

import { useState } from "react";
import { daysUntil, groupToSend, matches, newId, type Order, ORDER_STATUS, type OrderStatus, shortDate } from "@/lib/notes";
import { Badge, Chips, Clamp, CopyButton, EditorFrame, Empty, KindToggle, kindLabel, Label, RowActions } from "./bits";
import type { NotesApi } from "./useNotes";

const blank = (): Order => ({
  id: newId(),
  createdAt: Date.now(),
  updatedAt: 0,
  person: "",
  character: "",
  kind: "image",
  status: "open",
  deadline: "",
  paid: false,
  note: "",
});

const STATUS_ORDER: Record<OrderStatus, number> = { progress: 0, open: 1, tosend: 2, sent: 3 };

function sortOrders(list: Order[]) {
  // In Arbeit zuerst, dann nach Deadline (ohne Deadline hinten), dann älteste zuerst
  return [...list].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (a.deadline || "9999").localeCompare(b.deadline || "9999") ||
      a.createdAt - b.createdAt,
  );
}

function DeadlineBadge({ deadline, done }: { deadline: string; done: boolean }) {
  const d = daysUntil(deadline);
  if (d === null) return null;
  if (done) return <Badge>📅 {shortDate(deadline)}</Badge>;
  const tone = d < 0 ? "red" : d <= 2 ? "amber" : "muted";
  const when = d < 0 ? `${-d} T überfällig` : d === 0 ? "heute" : d === 1 ? "morgen" : `in ${d} T`;
  return (
    <Badge tone={tone}>
      📅 {shortDate(deadline)} · {when}
    </Badge>
  );
}

export function OrderEditor({ initial, onDone, notes, persons }: { initial: Order; onDone: () => void; notes: NotesApi; persons: string[] }) {
  const [o, setO] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<Order>) => setO((x) => ({ ...x, ...p }));
  const isNew = !initial.updatedAt;
  const listId = `persons-${initial.id}`;
  return (
    <EditorFrame
      canSave={!!(o.person.trim() || o.character.trim())}
      error={error}
      onCancel={onDone}
      onDelete={isNew ? undefined : () => (notes.remove("orders", o.id), onDone())}
      onSave={async () => {
        const res = await notes.save("orders", { ...o, person: o.person.trim(), character: o.character.trim() });
        if (res.ok) onDone();
        else setError(res.message);
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <Label>Für wen (Person)</Label>
          <input className="input" list={listId} value={o.person} onChange={(e) => set({ person: e.target.value })} placeholder="z. B. Max" autoFocus={isNew} />
          <datalist id={listId}>
            {persons.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <Label>Charakter / Set-Name</Label>
          <input className="input" value={o.character} onChange={(e) => set({ character: e.target.value })} placeholder="z. B. Ahri – Halloween" />
        </label>
      </div>
      <KindToggle value={o.kind} onChange={(kind) => set({ kind })} />
      <div>
        <Label>Status</Label>
        <Chips value={o.status} onChange={(status) => set({ status, ...(status === "sent" && !o.sentAt ? { sentAt: Date.now() } : {}) })} options={ORDER_STATUS.map((s) => ({ value: s.value, label: s.short }))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <Label>Deadline (optional)</Label>
          <input type="date" className="input" value={o.deadline} onChange={(e) => set({ deadline: e.target.value })} />
        </label>
        <label className="flex items-end gap-2 pb-3 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={o.paid} onChange={(e) => set({ paid: e.target.checked })} />
          bezahlt
        </label>
      </div>
      <label className="block">
        <Label>Notiz</Label>
        <textarea className="input min-h-20 text-sm" value={o.note} onChange={(e) => set({ note: e.target.value })} placeholder="Wünsche, Outfit, Anzahl Bilder …" />
      </label>
    </EditorFrame>
  );
}

function OrderCard({ o, notes, onEdit }: { o: Order; notes: NotesApi; onEdit: () => void }) {
  const setStatus = (status: OrderStatus) => notes.save("orders", { ...o, status, ...(status === "sent" ? { sentAt: Date.now() } : {}) });
  return (
    <div className={`space-y-2 rounded-xl border border-line bg-bg p-3 ${o.status === "sent" ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug">{o.character || "—"}</p>
          <p className="text-sm text-soft">für {o.person || "?"}</p>
        </div>
        <RowActions onEdit={onEdit} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={o.kind === "video" ? "accent" : "muted"}>{kindLabel(o.kind)}</Badge>
        <DeadlineBadge deadline={o.deadline} done={o.status === "sent" || o.status === "tosend"} />
        {o.paid ? <Badge tone="green">💰 bezahlt</Badge> : null}
      </div>
      <Clamp text={o.note} lines={2} />
      <Chips value={o.status} onChange={setStatus} options={ORDER_STATUS.map((s) => ({ value: s.value, label: s.short }))} />
    </div>
  );
}

export function OrdersTab({ notes, query }: { notes: NotesApi; query: string }) {
  const [editing, setEditing] = useState<Order | null>(null);
  const [showSent, setShowSent] = useState(false);
  const all = notes.data.orders.filter((o) => matches("orders", o, query));
  const active = sortOrders(all.filter((o) => o.status !== "sent"));
  const sent = [...all.filter((o) => o.status === "sent")].sort((a, b) => (b.sentAt ?? b.updatedAt) - (a.sentAt ?? a.updatedAt));
  const persons = [...new Set(notes.data.orders.map((o) => o.person.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));

  const render = (o: Order) =>
    editing?.id === o.id ? (
      <OrderEditor key={o.id} initial={editing} notes={notes} persons={persons} onDone={() => setEditing(null)} />
    ) : (
      <OrderCard key={o.id} o={o} notes={notes} onEdit={() => setEditing(o)} />
    );

  return (
    <div className="space-y-3">
      {editing && !editing.updatedAt ? (
        <OrderEditor initial={editing} notes={notes} persons={persons} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="btn btn-primary w-full" onClick={() => setEditing(blank())}>
          + Neuer Custom-Auftrag
        </button>
      )}
      {!active.length && <Empty>{query ? "Nichts gefunden." : "Keine offenen Aufträge."}</Empty>}
      {active.map(render)}
      {sent.length > 0 && (
        <button type="button" className="w-full py-2 text-sm text-muted underline" onClick={() => setShowSent(!showSent)}>
          {showSent ? "Verschickte ausblenden" : `Verschickte anzeigen (${sent.length})`}
        </button>
      )}
      {showSent && sent.map(render)}
    </div>
  );
}

/** „Noch zu schicken“, nach Person gruppiert – zum gesammelten Verschicken. */
export function SendTab({ notes, query }: { notes: NotesApi; query: string }) {
  const groups = groupToSend(notes.data.orders.filter((o) => matches("orders", o, query)));
  const total = groups.reduce((n, g) => n + g.orders.length, 0);
  const markSent = async (orders: Order[]) => {
    const now = Date.now();
    for (const o of orders) await notes.save("orders", { ...o, status: "sent", sentAt: now });
  };
  const summary = groups.map((g) => `${g.person}: ${g.orders.map((o) => `${o.character} (${o.kind === "video" ? "Video" : "Bild"})`).join(", ")}`).join("\n");

  if (!total) return <Empty>{query ? "Nichts gefunden." : "Nichts zu schicken. Fertige Aufträge auf „Zu schicken“ setzen, dann landen sie hier."}</Empty>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary flex-1"
          onClick={() => window.confirm(`Alle ${total} als verschickt markieren?`) && markSent(groups.flatMap((g) => g.orders))}
        >
          ✓ Alles verschickt ({total})
        </button>
        <CopyButton text={summary} label="📋 Liste kopieren" className="min-h-11" />
      </div>
      {groups.map((g) => (
        <div key={g.person} className="space-y-2 rounded-xl border border-line bg-bg p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">
              {g.person} <span className="text-sm font-normal text-muted">({g.orders.length})</span>
            </p>
            <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => markSent(g.orders)}>
              ✓ alle an {g.person}
            </button>
          </div>
          <ul className="space-y-1.5">
            {g.orders.map((o) => (
              <li key={o.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  {o.character || "—"} <span className="text-muted">· {kindLabel(o.kind)}</span>
                </span>
                <button type="button" className="h-9 rounded-lg border border-line px-3 text-xs text-soft" onClick={() => markSent([o])}>
                  ✓ verschickt
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
