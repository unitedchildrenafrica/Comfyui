"use client";

import { useEffect, useRef, useState } from "react";

export interface LiveSnapshot {
  connected: boolean;
  runningPromptId: string | null;
  node: string | null;
  progress: { value: number; max: number } | null;
  queueRemaining: number;
  previewSeq: number;
  startedAt: number | null;
  serverNow: number;
  nodeLabel: string | null;
  nodeClass: string | null;
  nodesDone: number;
  nodesTotal: number;
  /** Date.now() - serverNow beim Empfang (gleicht Uhr-Abweichung aus) */
  clockOffset: number;
}

export interface FinishedEvent {
  promptId: string;
  result: "success" | "error" | "interrupted";
  durationMs: number | null;
  error: { message: string; nodeId?: string; nodeType?: string } | null;
}

/** Live-Fortschritt per SSE (/api/events). Verbindet sich bei Abbruch selbst neu. */
export function useLive(onFinished?: (e: FinishedEvent) => void) {
  const [state, setState] = useState<LiveSnapshot | null>(null);
  const [sseOk, setSseOk] = useState(false);
  const cb = useRef(onFinished);
  cb.current = onFinished;

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const open = () => {
      es = new EventSource("/api/events");
      es.addEventListener("state", (e) => {
        setSseOk(true);
        const data = JSON.parse((e as MessageEvent).data);
        setState({ ...data, clockOffset: Date.now() - (data.serverNow ?? Date.now()) });
      });
      es.addEventListener("finished", (e) => cb.current?.(JSON.parse((e as MessageEvent).data)));
      es.onerror = () => {
        setSseOk(false);
        es?.close();
        if (!closed) retry = setTimeout(open, 3000);
      };
    };
    open();
    // Nach dem Entsperren des Handys sofort neu verbinden
    const onVisible = () => {
      if (document.visibilityState === "visible" && es?.readyState !== EventSource.OPEN) {
        es?.close();
        if (retry) clearTimeout(retry);
        open();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      es?.close();
      if (retry) clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { state, sseOk };
}
