"use client";

import { useEffect, useState } from "react";
import type { LiveSnapshot } from "@/hooks/useLive";
import { formatDuration } from "@/lib/format";
import { ProgressBar } from "./ui";

/** Wie in ComfyUI: Laufzeit, aktueller Node mit %, Gesamtfortschritt über alle Nodes. */
export function LiveProgress({ live }: { live: LiveSnapshot }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsed = live.startedAt ? now - live.clockOffset - live.startedAt : null;
  const p = live.progress;
  const nodePct = p && p.max > 0 ? Math.round((p.value / p.max) * 100) : null;
  const totalPct = live.nodesTotal > 0 ? Math.round((live.nodesDone / live.nodesTotal) * 100) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate">
          <span className="font-medium">{live.nodeLabel ?? "Startet …"}</span>
          {live.nodeClass && live.nodeClass !== live.nodeLabel && <span className="text-xs text-muted"> · {live.nodeClass}</span>}
        </span>
        <span className="shrink-0 font-mono tabular-nums text-soft">⏱ {formatDuration(elapsed)}</span>
      </div>
      {p ? (
        <>
          <div className="flex justify-between text-xs text-muted">
            <span>
              Step {p.value} / {p.max}
            </span>
            <span className="font-mono tabular-nums">{nodePct}%</span>
          </div>
          <ProgressBar value={p.value} max={p.max} />
        </>
      ) : (
        <div className="h-2.5 animate-pulse rounded-full bg-line" />
      )}
      {totalPct !== null && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="shrink-0">Gesamt</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-soft/60 transition-all" style={{ width: `${totalPct}%` }} />
          </div>
          <span className="shrink-0 font-mono tabular-nums">
            {totalPct}% · {live.nodesDone}/{live.nodesTotal} Nodes
          </span>
        </div>
      )}
    </div>
  );
}
