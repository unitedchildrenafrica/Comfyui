"use client";

import { useCallback, useEffect, useState } from "react";
import { type CircleRow, circleStats } from "@/lib/circle";
import { api } from "@/lib/client";

/** Wird von der Seite /circle nach jeder Änderung gefeuert */
export const CIRCLE_CHANGED = "pf:circle-changed";

/**
 * Inner-Circle-Stand für den Zähler „anschreiben“ im Notizen-Bereich – aus derselben Quelle wie der
 * Tab Circle (dort getippte Häkchen zählen sofort). Alle 10 Minuten und beim Zurückkehren neu.
 */
export function useCircle() {
  const [data, setData] = useState<{ configured: boolean; rows: CircleRow[] } | null>(null);
  const load = useCallback(() => {
    api<{ configured: boolean; rows: CircleRow[] }>("/api/circle").then(setData, () => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 10 * 60_000);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(CIRCLE_CHANGED, load);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(CIRCLE_CHANGED, load);
    };
  }, [load]);
  const rows = data?.rows ?? [];
  return { show: !!data && (data.configured || rows.length > 0), rows, toContact: circleStats(rows).toContact };
}
