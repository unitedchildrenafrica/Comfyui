"use client";

import { useCallback, useEffect, useState } from "react";
import { BellToggle } from "@/components/Alarm";
import { LiveProgress } from "@/components/LiveProgress";
import { LivePreview } from "@/components/LivePreview";
import { ComfyDown, ErrorBox, Segmented } from "@/components/ui";
import { liveFor, useLive } from "@/hooks/useLive";
import { api, ApiError } from "@/lib/client";
import { formatDuration } from "@/lib/format";
import { type PodsResponse, type PodView, podName } from "../einstellungen/PodCards";

const POD_KEY = "pf.queue.pod";

/** „🖼️ Bilder“ / „🎬 Videos“ – bei mehreren Pods als Name im Umschalter */
function podLabel(p: PodView) {
  if (p.roles.length === 1) return p.roles[0] === "bild" ? "🖼️ Bilder" : "🎬 Videos";
  return podName(p);
}
const podIcon = (p: PodView | undefined) => (!p || p.roles.length !== 1 ? "" : p.roles[0] === "bild" ? "🖼️ " : "🎬 ");

interface QueueItem {
  number: number;
  promptId: string;
  label: string;
  generator: string | null;
  kind: string | null;
  batchId: string | null;
  podId?: string;
}

interface RecentItem {
  podId?: string | null;
  promptId: string;
  label: string;
  generator: string | null;
  status: string;
  error?: string | null;
  durationMs: number | null;
}

export default function QueuePage() {
  const [queue, setQueue] = useState<{ running: QueueItem[]; pending: QueueItem[]; recent: RecentItem[] } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setQueue(await api("/api/queue"));
      setError(null);
    } catch (err) {
      setError(err as ApiError);
    }
  }, []);
  const { state } = useLive(() => load());

  // Server-Modus mit zwei Pods: zwischen Bild- und Video-Pod umschalten ("" = beide)
  const [pods, setPods] = useState<PodView[]>([]);
  const [podFilter, setPodFilter] = useState("");
  useEffect(() => {
    try {
      setPodFilter(localStorage.getItem(POD_KEY) ?? "");
    } catch {}
    const loadPods = () =>
      api<PodsResponse>("/api/pod").then(
        (r) => setPods(r.serverMode ? r.pods.filter((p) => p.online) : []),
        () => {},
      );
    loadPods();
    const t = setInterval(loadPods, 10_000);
    return () => clearInterval(t);
  }, []);
  const multi = pods.length > 1;
  const activePod = multi ? pods.find((p) => p.id === podFilter) : undefined;
  const choosePod = (id: string) => {
    setPodFilter(id);
    try {
      localStorage.setItem(POD_KEY, id);
    } catch {}
  };
  const mine = <T extends { podId?: string | null }>(list: T[]) => (activePod ? list.filter((x) => x.podId === activePod.id) : list);
  const podOf = (id?: string | null) => (multi ? pods.find((p) => p.id === id) : undefined);

  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (json: unknown, text?: string) => {
    try {
      await api("/api/queue", { method: "POST", json });
      if (text) setMsg(text);
      load();
    } catch (err) {
      setError(err as ApiError);
    }
  };

  const freeVram = async () => {
    try {
      await api("/api/free", { method: "POST", json: activePod ? { pod: activePod.id } : {} });
      setMsg(activePod ? `VRAM auf ${podLabel(activePod)} wird freigegeben.` : "VRAM wird freigegeben.");
    } catch (err) {
      setError(err as ApiError);
    }
  };

  const running = mine(queue?.running ?? []);
  const pending = mine(queue?.pending ?? []);
  const recent = mine(queue?.recent ?? []).slice(0, 8);

  return (
    <main className="page">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-lg font-semibold">Warteschlange</h1>
        <BellToggle />
      </div>
      {error && (error.comfyDown ? <ComfyDown onRetry={load} /> : <ErrorBox>{error.message}</ErrorBox>)}
      {msg && <p className="px-1 text-sm text-muted">{msg}</p>}

      {multi && (
        <Segmented
          value={activePod?.id ?? ""}
          onChange={choosePod}
          options={[{ value: "", label: "Beide" }, ...pods.map((p) => ({ value: p.id, label: podLabel(p) }))]}
        />
      )}

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Läuft</h2>
        {running.length === 0 && <p className="text-sm text-muted">Nichts in Arbeit.</p>}
        {running.map((r) => {
          const live = liveFor(state, [r.promptId]);
          return (
            <div key={r.promptId} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {!activePod && podIcon(podOf(r.podId))}
                  {r.label} <span className="text-xs text-muted">{r.generator}</span>
                </span>
                <button type="button" className="btn btn-ghost text-sm" onClick={() => act({ action: "interrupt", promptId: r.promptId }, "Unterbrochen.")}>
                  Stopp
                </button>
              </div>
              {live ? <LiveProgress live={live} /> : <div className="text-xs text-muted">Startet …</div>}
              {live && <LivePreview live={live} />}
            </div>
          );
        })}
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">Wartend ({pending.length})</h2>
        {pending.length === 0 && <p className="text-sm text-muted">Keine wartenden Jobs.</p>}
        <ul className="divide-y divide-line">
          {pending.slice(0, 300).map((p) => (
            <li key={p.promptId} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate text-sm">
                {!activePod && podIcon(podOf(p.podId))}
                {p.label} <span className="text-xs text-muted">{p.generator}</span>
              </span>
              <button type="button" className="btn btn-ghost px-3 text-sm" onClick={() => act({ action: "delete", ids: [p.promptId] })} aria-label="Löschen">
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      {recent.length > 0 && (
        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Zuletzt fertig</h2>
          <ul className="divide-y divide-line">
            {recent.map((r) => (
              <li key={r.promptId} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {r.status === "error" ? "⚠ " : r.status === "interrupted" ? "⏹ " : "✓ "}
                    {!activePod && podIcon(podOf(r.podId))}
                    {r.label} <span className="text-xs text-muted">{r.generator}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{formatDuration(r.durationMs)}</span>
                </div>
                {r.error && <p className="mt-1 break-words rounded-lg bg-red-500/10 px-2 py-1 text-xs text-red-200">{r.error}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn btn-danger"
          onClick={() =>
            window.confirm(
              activePod
                ? `Alle Jobs auf dem Pod ${podLabel(activePod)} abbrechen? Der andere Pod läuft weiter.`
                : multi
                  ? "Alle Jobs auf BEIDEN Pods abbrechen und die Warteschlangen leeren?"
                  : "Alle Jobs abbrechen und die Warteschlange leeren?",
            ) && act(activePod ? { action: "clear", pod: activePod.id } : { action: "clear" }, "Abgebrochen.")
          }
        >
          {activePod ? `${podLabel(activePod).replace(/^\S+\s/, "")} abbrechen` : "Alles abbrechen"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={freeVram}>
          VRAM freigeben
        </button>
      </div>
    </main>
  );
}
