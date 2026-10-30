"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Field, ProgressBar, Select, WarnBox } from "@/components/ui";
import { useOptions } from "@/hooks/useOptions";
import { redownload } from "@/lib/characterTools";
import { api, ApiError } from "@/lib/client";
import { classifyLora, guessUseFromBaseModel, type LoraUse } from "@/lib/loraKinds";
import { findAvailable } from "@/lib/notes";
import type { Options } from "@/lib/server/options";
import { MODEL_TYPES, type ModelType } from "@/lib/modelLinks";
import type { DownloadJob, Resolved, ResolvedFile } from "@/lib/server/downloads";

const TYPE_OPTIONS = Object.entries(MODEL_TYPES).map(([value, t]) => ({ value, label: `${t.label} → ${t.folder}` }));

const gb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(0)} MB`);

interface Choice extends ResolvedFile {
  selected: boolean;
  /** nur LoRAs: für Bilder oder Videos */
  use: "image" | "video" | null;
}

interface ModelLink {
  filename: string;
  type: ModelType;
  url: string;
  title?: string;
  savedAt: number;
}

/** Liste des Pods zum Typ – null, wenn es keine gibt (dann ist der Status unbekannt) */
function podList(o: Options | null, type: ModelType): string[] | null {
  if (!o) return null;
  const map: Partial<Record<ModelType, string[]>> = {
    checkpoint: o.checkpoints,
    lora: o.loras,
    unet: o.unets,
    vae: o.vaes,
    text_encoder: o.clips,
    upscaler: o.upscalers,
  };
  return map[type] ?? null;
}

/** Merkliste: einmal geladene Dateien mit Link – fehlende mit einem Tipp neu laden. */
function SavedLinks({ options, reload, onStarted }: { options: Options | null; reload: () => void; onStarted: () => void }) {
  const [links, setLinks] = useState<ModelLink[]>([]);
  const [state, setState] = useState<Record<string, { busy?: boolean; ok?: boolean; error?: string }>>({});
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    api<{ links: ModelLink[] }>("/api/model-links").then((r) => setLinks(r.links), () => {});
  }, []);
  useEffect(load, [load]);

  const status = (l: ModelLink) => {
    const list = podList(options, l.type);
    return list ? (findAvailable(l.filename, list) ? "here" : "missing") : "unknown";
  };
  const missing = links.filter((l) => status(l) === "missing" && !state[l.filename]?.ok);
  const shown = showAll ? links : links.filter((l) => status(l) !== "here");

  const get = async (l: ModelLink) => {
    setState((s) => ({ ...s, [l.filename]: { busy: true } }));
    try {
      await redownload(l.filename, l.url, l.type);
      setState((s) => ({ ...s, [l.filename]: { ok: true } }));
      onStarted();
    } catch (err) {
      setState((s) => ({ ...s, [l.filename]: { error: (err as Error).message } }));
    }
  };
  const forget = async (l: ModelLink) => {
    if (!window.confirm(`Link für ${l.filename} vergessen?`)) return;
    setLinks((await api<{ links: ModelLink[] }>(`/api/model-links?filename=${encodeURIComponent(l.filename)}`, { method: "DELETE" })).links);
  };

  if (!links.length) return null;
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Früher geladen</h2>
        <button type="button" className="text-xs text-accent underline" onClick={reload}>
          ↻ prüfen
        </button>
      </div>
      <p className="text-xs text-muted">
        Jede Datei, die hier einmal geladen wurde, behält ihren Link. Fehlt sie auf dem Pod (gelöscht oder neuer Pod), lädt „Neu laden“ sie unter demselben Namen.
      </p>
      {missing.length > 1 && (
        <button type="button" className="btn btn-primary w-full" onClick={() => missing.forEach(get)}>
          ⬇ Alle fehlenden neu laden ({missing.length})
        </button>
      )}
      {!shown.length && <p className="text-sm text-emerald-300">✓ Alles da.</p>}
      <ul className="space-y-2">
        {shown.map((l) => {
          const st = status(l);
          const s = state[l.filename];
          return (
            <li key={l.filename} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className={st === "missing" ? "text-red-300" : st === "here" ? "text-emerald-300" : "text-muted"}>{st === "missing" ? "✗" : st === "here" ? "✓" : "•"}</span>
              <span className="min-w-0 flex-1 truncate">
                {l.filename} <span className="text-xs text-muted">{MODEL_TYPES[l.type]?.folder}</span>
              </span>
              {st !== "here" &&
                (s?.ok ? (
                  <span className="text-xs text-emerald-300">läuft ↓</span>
                ) : (
                  <button type="button" className="h-9 rounded-lg border border-line px-3 text-xs text-soft" disabled={s?.busy} onClick={() => get(l)}>
                    {s?.busy ? "…" : "⬇ Neu laden"}
                  </button>
                ))}
              <button type="button" className="h-9 w-8 text-muted" aria-label="Link vergessen" onClick={() => forget(l)}>
                ✕
              </button>
              {s?.error && <span className="w-full text-xs text-red-300">{s.error}</span>}
            </li>
          );
        })}
      </ul>
      <button type="button" className="w-full text-xs text-muted underline" onClick={() => setShowAll(!showAll)}>
        {showAll ? "nur fehlende zeigen" : `alle zeigen (${links.length})`}
      </button>
    </section>
  );
}

const USE_CHIPS: { value: LoraUse; label: string }[] = [
  { value: "image", label: "🖼️ Bild" },
  { value: "video", label: "🎬 Video" },
  { value: "both", label: "Beide" },
];

/** Jede LoRA einer Liste zuordnen – Bild-LoRAs erscheinen dann nicht mehr bei Video und umgekehrt. */
function LoraSorter({ options }: { options: Options | null }) {
  const [overrides, setOverrides] = useState<Record<string, LoraUse>>({});
  const [filter, setFilter] = useState<"open" | "image" | "video" | "all">("open");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ overrides: Record<string, LoraUse> }>("/api/lora-kinds").then((r) => setOverrides(r.overrides), () => {});
  }, []);
  const loras = options?.loras ?? [];
  if (!loras.length) return null;
  const rows = loras.map((name) => ({ name, ...classifyLora(name, overrides) }));
  const count = (f: typeof filter) => rows.filter((r) => (f === "open" ? !r.use : f === "all" ? true : r.use === f || r.use === "both")).length;
  const shown = rows.filter((r) => (filter === "open" ? !r.use : filter === "all" ? true : r.use === filter || r.use === "both"));

  const set = async (name: string, use: LoraUse | null) => {
    setError(null);
    try {
      setOverrides((await api<{ overrides: Record<string, LoraUse> }>("/api/lora-kinds", { method: "PUT", json: { items: [{ name, use }] } })).overrides);
    } catch (err) {
      setError((err as ApiError).message);
    }
  };

  return (
    <section id="loras" className="card scroll-mt-4 space-y-3 p-4">
      <h2 className="font-semibold">LoRAs: Bild oder Video</h2>
      <p className="text-xs text-muted">
        Bei „Bild“ stehen nur Bild-LoRAs zur Auswahl, bei „Video“ nur Video-LoRAs. Bekannte LoRAs sind automatisch zugeordnet, nicht zugeordnete stehen in beiden Listen.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["open", "Nicht zugeordnet"],
            ["image", "Bild"],
            ["video", "Video"],
            ["all", "Alle"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setFilter(v)}
            className={`min-h-9 rounded-full border px-3 text-sm ${filter === v ? "border-accent bg-accent text-white" : "border-line text-soft"}`}
          >
            {label} ({count(v)})
          </button>
        ))}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!shown.length && <p className="text-sm text-muted">{filter === "open" ? "✓ Alle LoRAs sind zugeordnet." : "Keine."}</p>}
      <ul className="space-y-2">
        {shown.map((r) => (
          <li key={r.name} className="space-y-1.5 rounded-xl border border-line bg-bg p-2.5">
            <p className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1 break-all">{r.name.replace(/\.safetensors$/, "")}</span>
              {r.use && r.auto && <span className="shrink-0 text-xs text-muted">automatisch</span>}
              {!r.auto && (
                <button type="button" className="shrink-0 text-xs text-muted underline" onClick={() => set(r.name, null)}>
                  ↺ automatisch
                </button>
              )}
            </p>
            <div className="flex gap-1.5">
              {USE_CHIPS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => set(r.name, c.value)}
                  className={`min-h-9 flex-1 rounded-lg border text-sm ${r.use === c.value ? (r.auto ? "border-accent/60 text-accent" : "border-accent bg-accent text-white") : "border-line text-soft"}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ModelsPage() {
  const [url, setUrl] = useState("");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startErrors, setStartErrors] = useState<string[]>([]);
  const [downloads, setDownloads] = useState<DownloadJob[]>([]);
  const { options, reload: reloadOptions } = useOptions();

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
      setChoices(r.files.map((f) => ({ ...f, selected: !many || f.primary, use: guessUseFromBaseModel(r.baseModel, f.filename) })));
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
    if (items.some((c) => c.type === "lora" && !c.use)) {
      setError("Bitte bei der LoRA wählen: für Bilder oder für Videos.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ downloads: DownloadJob[]; errors: string[] }>("/api/models/downloads", {
        method: "POST",
        json: { items: items.map((c) => ({ url: c.url, type: c.type, filename: c.filename, sizeBytes: c.sizeBytes, title: resolved?.title, use: c.type === "lora" ? c.use : undefined })) },
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
                  {c.type === "lora" && (
                    <div className="flex gap-1.5">
                      {(["image", "video"] as const).map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => patch(i, { use: u })}
                          className={`min-h-10 flex-1 rounded-lg border text-sm ${c.use === u ? "border-accent bg-accent text-white" : "border-line text-soft"}`}
                        >
                          {u === "image" ? "🖼️ für Bilder" : "🎬 für Videos"}
                        </button>
                      ))}
                    </div>
                  )}
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

      <SavedLinks options={options} reload={reloadOptions} onStarted={loadDownloads} />

      <LoraSorter options={options} />

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
