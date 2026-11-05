"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import type { Options } from "@/lib/server/options";

export function useOptions() {
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setOptions(await api<Options>(`/api/options${refresh ? "?refresh=1" : ""}`));
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Kam nichts an (ComfyUI startet gerade, Pod wechselt), alle 10 s still nachfragen
  const incomplete = !!error || (!!options && !options.samplers.length);
  useEffect(() => {
    if (!incomplete) return;
    const t = setInterval(() => load(), 10_000);
    return () => clearInterval(t);
  }, [incomplete, load]);

  return { options, error, loading, reload: () => load(true) };
}
