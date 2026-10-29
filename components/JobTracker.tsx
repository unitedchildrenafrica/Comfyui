"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, viewUrl } from "@/lib/client";
import { useLive } from "@/hooks/useLive";
import { formatDuration } from "@/lib/format";
import { LivePreview } from "./LivePreview";
import { LiveProgress } from "./LiveProgress";
import { ErrorBox, ProgressBar } from "./ui";

interface MediaFile {
  filename: string;
  subfolder: string;
  type: string;
  kind: "image" | "video" | "audio";
}

interface JobStatus {
  history: { status: string; files: MediaFile[]; error?: string; durationMs: number | null } | null;
  error: { message: string; nodeId?: string; nodeType?: string } | null;
}

export interface Submitted {
  promptIds: string[];
  seeds: number[];
  batchId?: string;
  kind: "image" | "video";
}

/**
 * Zeigt Fortschritt und Ergebnisse der eben abgeschickten Jobs.
 * Live über SSE, zusätzlich alle 2 s Polling als Fallback.
 */
export function JobTracker({ submitted, onUseSeed, onAgain }: { submitted: Submitted; onUseSeed?: (seed: number) => void; onAgain?: () => void }) {
  const [results, setResults] = useState<Record<string, JobStatus>>({});
  const [cancelled, setCancelled] = useState(false);
  const doneRef = useRef(new Set<string>());
  const ids = submitted.promptIds;

  const fetchOne = useCallback(async (id: string) => {
    try {
      const s = await api<JobStatus>(`/api/jobs/${id}`);
      if (s.history?.status === "success" || s.history?.status === "error" || s.error) {
        doneRef.current.add(id);
        setResults((r) => ({ ...r, [id]: s }));
      }
    } catch {}
  }, []);

  const { state } = useLive((e) => {
    if (ids.includes(e.promptId)) fetchOne(e.promptId);
  });

  useEffect(() => {
    setResults({});
    doneRef.current = new Set();
    setCancelled(false);
  }, [submitted]);

  // Fallback-Polling: laufender/nächster Job + gelegentlich alle offenen
  useEffect(() => {
    let tick = 0;
    const t = setInterval(() => {
      tick++;
      const open = ids.filter((id) => !doneRef.current.has(id));
      if (!open.length) return;
      const check = tick % 5 === 0 ? open.slice(0, 50) : open.slice(0, 2);
      check.forEach(fetchOne);
    }, 2000);
    return () => clearInterval(t);
  }, [ids, fetchOne]);

  const done = Object.keys(results).length;
  const failed = Object.values(results).filter((r) => r.error || r.history?.status === "error").length;
  const runningHere = state?.runningPromptId && ids.includes(state.runningPromptId);
  const allDone = done >= ids.length || cancelled;
  const files = ids.flatMap((id) => results[id]?.history?.files ?? []);
  const durations = Object.values(results)
    .map((r) => r.history?.durationMs)
    .filter((d): d is number => typeof d === "number");
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  const cancel = async () => {
    if (submitted.batchId && ids.length > 1) await api(`/api/batches/${submitted.batchId}`, { method: "POST" });
    else await api("/api/queue", { method: "POST", json: { action: "interrupt", promptId: ids[0] } }).catch(() => {});
    if (ids.length === 1) await api("/api/queue", { method: "POST", json: { action: "delete", ids } }).catch(() => {});
    setCancelled(true);
  };

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">
          {ids.length > 1
            ? `${done} / ${ids.length} fertig`
            : allDone
              ? `Fertig${durations[0] !== undefined ? ` in ${formatDuration(durations[0])}` : ""}`
              : runningHere
                ? "Läuft …"
                : "In der Warteschlange"}
          {ids.length > 1 && avg !== null && <span className="text-sm font-normal text-muted"> · Ø {formatDuration(avg)} pro Job</span>}
          {failed > 0 && <span className="text-red-300"> · {failed} Fehler</span>}
        </span>
        {!allDone && (
          <button type="button" className="btn btn-ghost text-sm" onClick={cancel}>
            Abbrechen
          </button>
        )}
      </div>
      {ids.length > 1 && <ProgressBar value={done} max={ids.length} />}
      {runningHere && state && <LiveProgress live={state} />}
      {runningHere && state && <LivePreview live={state} className="max-h-80" />}
      {cancelled && <p className="text-sm text-muted">Abgebrochen – wartende Jobs wurden gelöscht.</p>}
      {Object.entries(results)
        .filter(([, r]) => r.error)
        .slice(0, 5)
        .map(([id, r]) => (
          <ErrorBox key={id}>
            {r.error!.nodeType ? `${r.error!.nodeType} (Node ${r.error!.nodeId}): ` : ""}
            {r.error!.message}
          </ErrorBox>
        ))}
      {files.length > 0 && (
        <div className={submitted.kind === "video" ? "space-y-3" : "grid grid-cols-2 gap-2"}>
          {files
            .filter((f) => f.kind !== "audio")
            .slice(-40)
            .map((f) =>
              f.kind === "video" ? (
                <div key={f.subfolder + f.filename} className="space-y-2">
                  <video src={viewUrl(f)} controls playsInline className="w-full rounded-lg bg-black" />
                  <a className="btn btn-ghost w-full" href={viewUrl(f, { download: "1" })}>
                    Download
                  </a>
                </div>
              ) : (
                <a key={f.subfolder + f.filename} href={viewUrl(f)} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={viewUrl(f, { preview: "webp;80" })} alt={f.filename} className="w-full rounded-lg" loading="lazy" />
                </a>
              ),
            )}
        </div>
      )}
      {allDone && (onAgain || onUseSeed) && (
        <div className="flex gap-2">
          {onAgain && (
            <button type="button" className="btn btn-ghost flex-1" onClick={onAgain}>
              Nochmal
            </button>
          )}
          {onUseSeed && submitted.seeds.length === 1 && (
            <button type="button" className="btn btn-ghost flex-1" onClick={() => onUseSeed(submitted.seeds[0])}>
              Seed übernehmen ({submitted.seeds[0]})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
