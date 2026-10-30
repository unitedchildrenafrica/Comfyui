"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ComfyDown, ErrorBox, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/client";
import type { ImageGenerator } from "@/lib/types";

interface Status {
  comfyVersion: string;
  pytorch?: string;
  gpu: string;
  vramTotal: number;
  vramFree: number;
  ramTotal: number;
  ramFree: number;
  wsConnected: boolean;
}

interface AppSettings {
  folders: Record<ImageGenerator, string>;
  defaultNegative: string;
}

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusErr, setStatusErr] = useState<ApiError | null>(null);
  const [app, setApp] = useState<AppSettings | null>(null);
  const [presets, setPresets] = useState<Record<string, { generator: string }>>({});
  const [saved, setSaved] = useState(false);
  const [pod, setPod] = useState<{ serverMode: boolean; online: boolean; link: { url: string; gpu?: string; registeredAt: number; lastSeen: number } | null } | null>(null);

  const check = useCallback(async () => {
    setStatusErr(null);
    try {
      setStatus(await api<Status>("/api/status"));
    } catch (err) {
      setStatus(null);
      setStatusErr(err as ApiError);
    }
  }, []);

  useEffect(() => {
    check();
    api<AppSettings>("/api/app-settings").then(setApp).catch(() => {});
    api<typeof presets>("/api/presets").then(setPresets).catch(() => {});
    api<typeof pod>("/api/pod").then(setPod).catch(() => {});
  }, [check]);

  const save = async () => {
    if (!app) return;
    setApp(await api<AppSettings>("/api/app-settings", { method: "PUT", json: app }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const removePreset = async (name: string) => {
    if (!window.confirm(`Preset „${name}“ löschen?`)) return;
    setPresets(await api(`/api/presets?name=${encodeURIComponent(name)}`, { method: "DELETE" }));
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <main className="page">
      <h1 className="px-1 text-lg font-semibold">Einstellungen</h1>

      {statusErr?.comfyDown ? (
        <ComfyDown onRetry={check} />
      ) : statusErr ? (
        <ErrorBox>{statusErr.message}</ErrorBox>
      ) : (
        <section className="card space-y-2 p-4 text-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">ComfyUI</h2>
            <span className={status ? "text-emerald-400" : "text-muted"}>{status ? "● verbunden" : "prüfe …"}</span>
          </div>
          {status && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">GPU</dt>
              <dd>{status.gpu}</dd>
              <dt className="text-muted">VRAM</dt>
              <dd>
                {gb(status.vramTotal - status.vramFree)} / {gb(status.vramTotal)} belegt
              </dd>
              <dt className="text-muted">RAM</dt>
              <dd>
                {gb(status.ramTotal - status.ramFree)} / {gb(status.ramTotal)}
              </dd>
              <dt className="text-muted">Version</dt>
              <dd>
                {status.comfyVersion}
                {status.pytorch ? ` · torch ${status.pytorch}` : ""}
              </dd>
              <dt className="text-muted">Live-Events</dt>
              <dd>{status.wsConnected ? "WebSocket verbunden" : "nicht verbunden (Polling)"}</dd>
            </dl>
          )}
          <button type="button" className="btn btn-ghost w-full" onClick={check}>
            Verbindung testen
          </button>
        </section>
      )}

      {pod?.serverMode && (
        <section className="card space-y-1 p-4 text-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Server-Modus</h2>
            <span className={pod.online ? "text-emerald-400" : "text-amber-300"}>{pod.online ? "● Pod verbunden" : "○ kein Pod"}</span>
          </div>
          {pod.link ? (
            <p className="text-muted">
              {pod.link.gpu ?? "GPU-Pod"} · angemeldet {new Date(pod.link.registeredAt).toLocaleString("de-DE")} · zuletzt gemeldet{" "}
              {new Date(pod.link.lastSeen).toLocaleTimeString("de-DE")}
            </p>
          ) : (
            <p className="text-muted">Noch kein Pod angemeldet. Starte einen Pod mit VPS_URL und POD_SECRET im Template.</p>
          )}
          <p className="text-xs text-muted">Bilder und Videos werden automatisch auf diesen Server kopiert und bleiben auch ohne Pod in der Galerie.</p>
        </section>
      )}

      <Link href="/modelle" className="btn btn-primary w-full">
        + Checkpoint / LoRA per Link laden
      </Link>

      {app && (
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Standards</h2>
          <div className="grid grid-cols-3 gap-2">
            {(["wai", "pony", "anima"] as const).map((g) => (
              <Field key={g} label={`Ordner ${g}`}>
                <input className="input" value={app.folders[g]} onChange={(e) => setApp({ ...app, folders: { ...app.folders, [g]: e.target.value } })} />
              </Field>
            ))}
          </div>
          <Field label="Standard-Negativ">
            <textarea className="input min-h-20" value={app.defaultNegative} onChange={(e) => setApp({ ...app, defaultNegative: e.target.value })} />
          </Field>
          <button type="button" className="btn btn-primary w-full" onClick={save}>
            {saved ? "Gespeichert ✓" : "Speichern"}
          </button>
        </section>
      )}

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">Presets</h2>
        {Object.keys(presets).length === 0 && <p className="text-sm text-muted">Keine Presets.</p>}
        <ul className="divide-y divide-line">
          {Object.entries(presets).map(([name, p]) => (
            <li key={name} className="flex items-center justify-between py-2 text-sm">
              <span>
                {name} <span className="text-xs text-muted">{p.generator}</span>
              </span>
              <button type="button" className="btn btn-ghost px-3" onClick={() => removePreset(name)} aria-label="Löschen">
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      <button type="button" className="btn btn-ghost w-full" onClick={logout}>
        Abmelden
      </button>
    </main>
  );
}
