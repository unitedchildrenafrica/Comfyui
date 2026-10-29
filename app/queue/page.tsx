"use client";

import { useCallback, useEffect, useState } from "react";
import { BellToggle } from "@/components/Alarm";
import { LiveProgress } from "@/components/LiveProgress";
import { LivePreview } from "@/components/LivePreview";
import { ComfyDown, ErrorBox } from "@/components/ui";
import { useLive } from "@/hooks/useLive";
import { api, ApiError } from "@/lib/client";
import { formatDuration } from "@/lib/format";

interface QueueItem {
  number: number;
  promptId: string;
  label: string;
  generator: string | null;
  kind: string | null;
  batchId: string | null;
}

interface RecentItem {
  promptId: string;
  label: string;
  generator: string | null;
  status: string;
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
      await api("/api/free", { method: "POST" });
      setMsg("VRAM wird freigegeben.");
    } catch (err) {
      setError(err as ApiError);
    }
  };

  const running = queue?.running ?? [];
  const pending = queue?.pending ?? [];

  return (
    <main className="page">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-lg font-semibold">Warteschlange</h1>
        <BellToggle />
      </div>
      {error && (error.comfyDown ? <ComfyDown onRetry={load} /> : <ErrorBox>{error.message}</ErrorBox>)}
      {msg && <p className="px-1 text-sm text-muted">{msg}</p>}

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Läuft</h2>
        {running.length === 0 && <p className="text-sm text-muted">Nichts in Arbeit.</p>}
        {running.map((r) => {
          const live = state?.runningPromptId === r.promptId ? state : null;
          return (
            <div key={r.promptId} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
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
                {p.label} <span className="text-xs text-muted">{p.generator}</span>
              </span>
              <button type="button" className="btn btn-ghost px-3 text-sm" onClick={() => act({ action: "delete", ids: [p.promptId] })} aria-label="Löschen">
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      {(queue?.recent.length ?? 0) > 0 && (
        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Zuletzt fertig</h2>
          <ul className="divide-y divide-line">
            {queue!.recent.map((r) => (
              <li key={r.promptId} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {r.status === "error" ? "⚠ " : "✓ "}
                  {r.label} <span className="text-xs text-muted">{r.generator}</span>
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{formatDuration(r.durationMs)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => window.confirm("Alle Jobs abbrechen und die Warteschlange leeren?") && act({ action: "clear" }, "Alles abgebrochen.")}
        >
          Alles abbrechen
        </button>
        <button type="button" className="btn btn-ghost" onClick={freeVram}>
          VRAM freigeben
        </button>
      </div>
    </main>
  );
}
