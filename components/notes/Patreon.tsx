"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { type MemberView, type PatreonTier, deDate } from "@/lib/patreon";
import { Badge, CopyButton, Empty } from "./bits";

export interface PatreonData {
  configured: boolean;
  syncedAt: number | null;
  error: string | null;
  tiers: PatreonTier[];
  trackedTiers: string[] | null;
  members: MemberView[];
}

/** Patreon-Stand laden; alle 10 Minuten und beim Zurückkehren in den Tab auffrischen. */
export function usePatreon() {
  const [data, setData] = useState<PatreonData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<PatreonData>("/api/patreon"));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 10 * 60_000);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);
  const post = useCallback(async (json: Record<string, unknown>) => {
    setBusy(true);
    try {
      setData(await api<PatreonData>("/api/patreon", { method: "POST", json }));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  return { data, busy, error, post, reload: load };
}

export type PatreonApi = ReturnType<typeof usePatreon>;

const SETUP_CMD = "bash /root/setup-server.sh patreon";

function tierNames(m: MemberView, tiers: PatreonTier[]) {
  return m.tierIds.map((id) => tiers.find((t) => t.id === id)?.title).filter(Boolean).join(", ");
}

export function PatreonTab({ p, query }: { p: PatreonApi; query: string }) {
  const [showFormer, setShowFormer] = useState(false);
  const d = p.data;
  if (!d) return p.error ? <Empty>Patreon: {p.error}</Empty> : <p className="py-6 text-center text-sm text-muted">Lade …</p>;

  if (!d.configured)
    return (
      <div className="space-y-3 rounded-xl border border-line bg-bg p-3 text-sm">
        <p className="font-semibold">Patreon verbinden</p>
        <p className="text-soft">
          Einmal auf dem one.com-Server ausführen und die Werte aus dem Patreon-Portal (Client ID, Client Secret, Creator&apos;s Access Token, Creator&apos;s Refresh Token) eingeben:
        </p>
        <pre className="overflow-x-auto rounded-lg bg-card px-3 py-2 font-mono text-[13px]">{SETUP_CMD}</pre>
        <CopyButton text={SETUP_CMD} className="w-full" />
        <p className="text-xs text-muted">Danach füllt sich die Liste automatisch und wird stündlich aktualisiert.</p>
      </div>
    );

  const q = query.toLowerCase();
  const list = d.members.filter((m) => !q || `${m.name} ${m.email}`.toLowerCase().includes(q));
  const by = (s: MemberView["state"]) => list.filter((m) => m.state === s);
  const contact = by("contact");
  const declined = by("declined");
  const done = by("done");
  const waiting = by("waiting");
  const former = by("former");
  const tracked = d.trackedTiers ? new Set(d.trackedTiers) : null;

  const toggleTier = (id: string) => {
    const all = d.tiers.map((t) => t.id);
    const cur = new Set(tracked ?? all);
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    const next = [...cur];
    p.post({ action: "tiers", tiers: next.length === all.length ? null : next });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted">
        <span>{d.syncedAt ? `Stand: ${new Date(d.syncedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}` : "Noch nicht abgefragt"}</span>
        <button type="button" className="text-accent underline" disabled={p.busy} onClick={() => p.post({ action: "sync" })}>
          {p.busy ? "…" : "↻ Jetzt abfragen"}
        </button>
      </div>
      {(d.error || p.error) && <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{p.error || d.error}</p>}

      {d.tiers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {d.tiers.map((t) => {
            const on = !tracked || tracked.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTier(t.id)}
                className={`min-h-8 rounded-full border px-3 text-xs ${on ? "border-accent text-accent" : "border-line text-muted line-through"}`}
              >
                {t.title}
              </button>
            );
          })}
        </div>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="font-semibold">Hat gezahlt – anschreiben ({contact.length})</h3>
          {contact.length > 1 && (
            <button
              type="button"
              className="text-xs text-muted underline"
              onClick={() =>
                window.confirm(`Alle ${contact.length} als angeschrieben markieren?`) &&
                p.post({ action: "ack-all", members: contact.map((m) => ({ memberId: m.id, charge: m.lastCharge })) })
              }
            >
              alle abhaken
            </button>
          )}
        </div>
        {!contact.length && <Empty>Gerade niemand. Sobald jemand neu zahlt, steht er hier.</Empty>}
        {contact.map((m) => (
          <div key={m.id} className="space-y-2 rounded-xl border border-emerald-500/40 bg-bg p-3">
            <div className="min-w-0">
              <p className="font-semibold leading-snug">{m.name}</p>
              <p className="text-xs text-muted">
                {tierNames(m, d.tiers) || "–"} · gezahlt am {deDate(m.lastCharge)}
                {m.ackedCharge ? "" : m.since && m.since.slice(0, 10) === (m.lastCharge ?? "").slice(0, 10) ? " · neu dabei" : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary min-h-9 flex-1 text-sm" disabled={p.busy} onClick={() => p.post({ action: "ack", memberId: m.id, charge: m.lastCharge })}>
                ✓ Angeschrieben
              </button>
              <CopyButton text={m.name} label="📋 Name" />
              {m.url && (
                <a className="btn btn-ghost min-h-9 px-3 text-sm" href={m.url} target="_blank" rel="noreferrer">
                  Profil
                </a>
              )}
            </div>
          </div>
        ))}
      </section>

      {declined.length > 0 && (
        <section className="space-y-2">
          <h3 className="px-1 font-semibold text-red-300">Zahlung abgelehnt ({declined.length})</h3>
          {declined.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-bg p-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{m.name}</span>
                <span className="block text-xs text-muted">
                  {tierNames(m, d.tiers)} · letzte Abbuchung {deDate(m.lastCharge)} ({m.lastChargeStatus ?? "?"})
                </span>
              </span>
              {m.url && (
                <a className="btn btn-ghost min-h-9 px-3 text-sm" href={m.url} target="_blank" rel="noreferrer">
                  Profil
                </a>
              )}
            </div>
          ))}
        </section>
      )}

      {(done.length > 0 || waiting.length > 0) && (
        <section className="space-y-1.5">
          <h3 className="px-1 font-semibold">Angeschrieben – Pause bis zur nächsten Zahlung ({done.length})</h3>
          {done.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-xl border border-line bg-bg px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                {m.name}
                <span className="block text-xs text-muted">
                  gezahlt {deDate(m.lastCharge)} · nächste Zahlung {deDate(m.nextCharge)}
                </span>
              </span>
              <button type="button" className="h-9 rounded-lg px-2 text-xs text-muted underline" onClick={() => p.post({ action: "unack", memberId: m.id })}>
                ↺
              </button>
            </div>
          ))}
          {waiting.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-xl border border-line bg-bg px-3 py-2 text-sm opacity-80">
              <span className="min-w-0 flex-1">
                {m.name} <Badge tone="amber">{m.lastChargeStatus ?? "noch keine Zahlung"}</Badge>
                <span className="block text-xs text-muted">nächste Zahlung {deDate(m.nextCharge)}</span>
              </span>
            </div>
          ))}
        </section>
      )}

      {former.length > 0 && (
        <>
          <button type="button" className="w-full py-2 text-sm text-muted underline" onClick={() => setShowFormer(!showFormer)}>
            {showFormer ? "Ehemalige ausblenden" : `Ehemalige anzeigen (${former.length})`}
          </button>
          {showFormer &&
            former.map((m) => (
              <p key={m.id} className="px-1 text-sm text-muted">
                {m.name} · zuletzt {deDate(m.lastCharge)}
              </p>
            ))}
        </>
      )}
    </div>
  );
}
