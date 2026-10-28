"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Field, ProgressBar, Select, WarnBox } from "@/components/ui";
import { api, ApiError } from "@/lib/client";
import { MODEL_TYPES, type ModelType } from "@/lib/modelLinks";
import type { DownloadJob, Resolved, ResolvedFile } from "@/lib/server/downloads";

const TYPE_OPTIONS = Object.entries(MODEL_TYPES).map(([value, t]) => ({ value, label: `${t.label} → ${t.folder}` }));

const gb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(0)} MB`);

interface Choice extends ResolvedFile {
  selected: boolean;
}

export default function ModelsPage() {
  const [url, setUrl] = useState("");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startErrors, setStartErrors] = useState<string[]>([]);
  const [downloads, setDownloads] = useState<DownloadJob[]>([]);

  const loadDownloads = useCallback(async () => {
    try {
      setDownloads((await api<{ downloads: DownloadJob[] }>("/api/models/downloads")).downloads);
    } catch {}
  }, []);

  useEffect(() => {
    loadDownloads();
  }, [loadDownloads]);

  // Während etwas läuft, jede Sekunde den Fortschritt holen
  const running = downloads.some((d) => d.status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(loadDownloads, 1000);
    return () => clearInterval(t);
  }, [running, loadDownloads]);

  const check = async (versionId?: number) => {
    setBusy(true);
    setError(null);
    setStartErrors([]);
    try {
      const r = await api<Resolved>("/api/models/resolve", { method: "POST", json: { url, versionId } });
      setResolved(r);
      // Bei mehreren Dateien nur die Haupt-Datei vorauswählen – außer bei Anima (Modell + Encoder + VAE)
      const many = r.files.length > 1 && !/anima/i.test(r.baseModel ?? "");
      setChoices(r.files.map((f) => ({ ...f, selected: !many || f.primary })));
    } catch (err) {
      setResolved(null);
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    const items = choices.filter((c) => c.selected);
    if (items.some((c) => !c.type)) {
      setError("Bitte bei jeder Datei auswählen, wohin sie gehört.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ downloads: DownloadJob[]; errors: string[] }>("/api/models/downloads", {
        method: "POST",
        json: { items: items.map((c) => ({ url: c.url, type: c.type, filename: c.filename, sizeBytes: c.sizeBytes })) },
      });
      setDownloads(res.downloads);
      setStartErrors(res.errors);
      if (!res.errors.length) {
        setResolved(null);
        setUrl("");
      }
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => setDownloads((await api<{ downloads: DownloadJob[] }>(`/api/models/downloads?id=${id}`, { method: "DELETE" })).downloads);
  const patch = (i: number, p: Partial<Choice>) => setChoices((c) => c.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const total = choices.filter((c) => c.selected).reduce((s, c) => s + (c.sizeBytes ?? 0), 0);

  return (
    <main className="page">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-lg font-semibold">Modelle laden</h1>
        <Link href="/einstellungen" className="text-sm text-accent underline">
          zurück
        </Link>
      </div>

      <section className="card space-y-3 p-4">
        <Field label="Link" hint="Civitai-Modellseite oder Download-Link, Hugging Face (Datei-Link) oder direkter Link zu einer .safetensors-Datei.">
          <textarea
            className="input min-h-20 text-sm"
            value={url}
            placeholder="https://civitai.red/models/827184/wai-illustrious-sdxl"
            onChange={(e) => setUrl(e.target.value.trim())}
          />
        </Field>
        <button type="button" className="btn btn-primary w-full" disabled={!url || busy} onClick={() => check()}>
          {busy && !resolved ? "Prüfe …" : "Link prüfen"}
        </button>
        {error && <ErrorBox>{error}</ErrorBox>}
      </section>

      {resolved && (
        <section className="card space-y-4 p-4">
          <div>
            <p className="font-semibold">{resolved.title}</p>
            {resolved.baseModel && <p className="text-xs text-muted">Basis: {resolved.baseModel}</p>}
          </div>
          {resolved.notice && <WarnBox>{resolved.notice}</WarnBox>}
          {resolved.tokenMissing && (
            <WarnBox>{resolved.source === "civitai" ? "CIVITAI_TOKEN" : "HF_TOKEN"} ist in der App nicht gesetzt – manche Modelle lassen sich dann nicht laden.</WarnBox>
          )}
          {resolved.versions && resolved.versions.length > 1 && (
            <Field label="Version">
              <Select
                value={String(resolved.versionId ?? "")}
                onChange={(v) => check(Number(v))}
                options={resolved.versions.map((v) => ({ value: String(v.id), label: v.name }))}
              />
            </Field>
          )}
          {choices.map((c, i) => (
            <div key={c.url + i} className="space-y-2 rounded-xl border border-line bg-bg p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={c.selected} onChange={(e) => patch(i, { selected: e.target.checked })} />
                <span className="font-medium">{c.label}</span>
                {c.sizeBytes ? <span className="ml-auto text-muted">{gb(c.sizeBytes)}</span> : null}
              </label>
              {c.selected && (
                <>
                  <Select value={c.type ?? ""} onChange={(v) => patch(i, { type: v as ModelType })} options={TYPE_OPTIONS} placeholder="Wohin? – auswählen –" />
                  <input className="input text-sm" value={c.filename} onChange={(e) => patch(i, { filename: e.target.value })} aria-label="Dateiname" />
                </>
              )}
            </div>
          ))}
          {startErrors.length > 0 && (
            <ErrorBox>
              <ul className="space-y-1">
                {startErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </ErrorBox>
          )}
          <button type="button" className="btn btn-primary w-full" disabled={busy || !choices.some((c) => c.selected)} onClick={start}>
            Herunterladen{total ? ` (${gb(total)})` : ""}
          </button>
        </section>
      )}

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Downloads</h2>
        {!downloads.length && <p className="text-sm text-muted">Noch nichts geladen. Downloads laufen auf dem Pod weiter, auch wenn du die Seite schließt.</p>}
        {downloads.map((d) => (
          <div key={d.id} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {d.filename} <span className="text-xs text-muted">{d.folder}</span>
              </span>
              <button type="button" className="btn btn-ghost px-3 text-sm" onClick={() => remove(d.id)} aria-label={d.status === "running" ? "Abbrechen" : "Entfernen"}>
                {d.status === "running" ? "Stopp" : "✕"}
              </button>
            </div>
            {d.status === "running" && (
              <>
                <ProgressBar value={d.received} max={d.total ?? 0} />
                <p className="text-xs text-muted">
                  {gb(d.received)}
                  {d.total ? ` / ${gb(d.total)}` : ""} · {(d.speed / 1e6).toFixed(0)} MB/s
                </p>
              </>
            )}
            {d.status === "done" && <p className="text-xs text-emerald-400">Fertig – steht jetzt in den Auswahllisten.</p>}
            {d.status === "cancelled" && <p className="text-xs text-muted">Abgebrochen.</p>}
            {d.status === "error" && <p className="text-xs text-red-300">Fehler: {d.error}</p>}
          </div>
        ))}
      </section>
    </main>
  );
}
