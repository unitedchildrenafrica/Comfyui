"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { type MemberView, type PatreonTier } from "@/lib/patreon";

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
