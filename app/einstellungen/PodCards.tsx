"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type ApiError } from "@/lib/client";

export interface PodView {
  id: string;
  gpu: string | null;
  kind: "bilder" | "video" | "alles";
  pin: "bild" | "video" | null;
  online: boolean;
  roles: ("bild" | "video")[];
  registeredAt: number;
  lastSeen: number;
  live: { connected: boolean; error: string | null };
}

export interface PodsResponse {
  serverMode: boolean;
  pods: PodView[];
  roles: { bild: string | null; video: string | null };
}

interface Stats {
  gpu: string;
  vramTotal: number;
  vramFree: number;
  ramTotal: number;
  ramFree: number;
  comfyVersion: string;
}

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;
const KIND_LABEL = { bilder: "Setup „bilder“", video: "Setup „video“", alles: "Setup „alles“" } as const;
const roleBadge = (r: "bild" | "video") => (r === "bild" ? "🖼️ Bilder" : "🎬 Videos");

/** Kurzer Name für einen Pod, z. B. „RTX 5090 (C.6098…)“ */
export function podName(p: Pick<PodView, "gpu" | "id">) {
  const gpu = p.gpu?.replace(/^NVIDIA\s+(GeForce\s+)?/i, "") || "GPU-Pod";
  return p.id === "legacy" ? gpu : `${gpu} · ${p.id.slice(0, 10)}`;
}

function PodCard({ pod, onChange }: { pod: PodView; onChange: (r: PodsResponse) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const test = useCallback(async () => {
    setErr(null);
    try {
      setStats(await api<Stats>(`/api/status?pod=${encodeURIComponent(pod.id)}`));
    } catch (e) {
      setStats(null);
      setErr((e as ApiError).message);
    }
  }, [pod.id]);

  useEffect(() => {
    if (pod.online) test();
  }, [pod.online, test]);

  const post = async (json: Record<string, unknown>) => {
    setBusy(true);
    try {
      onChange(await api<PodsResponse>("/api/pod", { method: "POST", json: { id: pod.id, ...json } }));
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`space-y-2 rounded-xl border p-3 ${pod.online ? "border-line" : "border-line opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-medium">{podName(pod)}</span>
        {pod.roles.map((r) => (
          <span key={r} className="rounded-md bg-accent/20 px-2 py-0.5 text-xs text-accent">
            {roleBadge(r)}
          </span>
        ))}
        <span className={`text-xs ${pod.online ? "text-emerald-400" : "text-amber-300"}`}>{pod.online ? "● verbunden" : "○ getrennt"}</span>
      </div>
      <p className="text-xs text-muted">
        {KIND_LABEL[pod.kind]} · angemeldet {new Date(pod.registeredAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} · zuletzt{" "}
        {new Date(pod.lastSeen).toLocaleTimeString("de-DE")}
      </p>
      {pod.online && (
        <p className={`text-xs ${pod.live.connected ? "text-emerald-400" : "text-amber-300"}`}>
          Live-Fortschritt: {pod.live.connected ? "verbunden" : "getrennt"}
          {!pod.live.connected && pod.live.error ? <span className="block text-muted">{pod.live.error}</span> : null}
        </p>
      )}
      {stats && (
        <p className="text-xs text-soft">
          VRAM {gb(stats.vramTotal - stats.vramFree)} / {gb(stats.vramTotal)} · RAM {gb(stats.ramTotal - stats.ramFree)} / {gb(stats.ramTotal)} · ComfyUI {stats.comfyVersion}
        </p>
      )}
      {err && <p className="text-xs text-red-300">{err}</p>}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            [null, "Automatisch"],
            ["bild", "Nur Bilder"],
            ["video", "Nur Videos"],
          ] as const
        ).map(([role, label]) => (
          <button
            key={label}
            type="button"
            disabled={busy}
            onClick={() => post({ action: "pin", role })}
            className={`min-h-9 flex-1 rounded-lg border px-2 text-xs ${pod.pin === role ? "border-accent bg-accent text-white" : "border-line text-soft"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        {pod.online && (
          <button type="button" className="btn btn-ghost min-h-9 flex-1 text-xs" onClick={test}>
            Verbindung testen
          </button>
        )}
        {!pod.online && (
          <button
            type="button"
            className="btn btn-ghost min-h-9 flex-1 text-xs text-red-300"
            disabled={busy}
            onClick={() => window.confirm(`„${podName(pod)}“ aus der Liste entfernen? Meldet er sich wieder, erscheint er von selbst.`) && post({ action: "remove" })}
          >
            Aus Liste entfernen
          </button>
        )}
      </div>
    </div>
  );
}

/** Server-Modus: alle angemeldeten Pods mit Rolle (Bilder/Videos) und Status */
export function PodCards({ data, onChange }: { data: PodsResponse; onChange: (r: PodsResponse) => void }) {
  const online = data.pods.filter((p) => p.online);
  return (
    <section className="card space-y-2 p-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Pods</h2>
        <span className={online.length ? "text-emerald-400" : "text-amber-300"}>{online.length ? `● ${online.length} verbunden` : "○ kein Pod"}</span>
      </div>
      {!data.pods.length && <p className="text-muted">Noch kein Pod angemeldet. Starte einen Pod mit VPS_URL und POD_SECRET im Template.</p>}
      {data.pods.map((p) => (
        <PodCard key={p.id} pod={p} onChange={onChange} />
      ))}
      <p className="text-xs text-muted">
        {online.length > 1
          ? "Bilder gehen an den Pod mit 🖼️, Videos an den Pod mit 🎬 – beides läuft gleichzeitig."
          : "Ein Pod macht Bilder und Videos. Starte einen zweiten Pod mit „setup.sh bilder“, dann gehen Bilder automatisch dorthin."}{" "}
        Alles wird auf diesen Server kopiert und bleibt auch ohne Pod in der Galerie.
      </p>
    </section>
  );
}
