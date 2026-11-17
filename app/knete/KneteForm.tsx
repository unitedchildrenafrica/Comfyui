"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBox, Field, ProgressBar, Section, Segmented, Select, Slider, WarnBox } from "@/components/ui";
import { api } from "@/lib/client";
import {
  KNETE_MAX_REFS,
  KNETE_MODELS,
  type KneteItem,
  type KneteJob,
  type KneteJobSummary,
  type KneteSettings,
  outputSize,
} from "@/lib/knete";

// Vorübergehender Bereich: Fotos per OpenAI im Knete-Stil der eigenen Referenzbilder neu erzeugen.

const fileUrl = (q: Record<string, string | number | undefined>) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") qs.set(k, String(v));
  return `/api/knete/file?${qs}`;
};

const usd = (v: number) => `$${v.toFixed(v < 1 ? 3 : 2)}`;

/** Foto im Browser verkleinern (spart Upload am Handy). Klappt das nicht, geht das Original hoch. */
async function shrink(file: File, maxSide = 2048): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
    return blob ?? file;
  } catch {
    return file;
  }
}

async function upload(url: string, blob: Blob, name: string) {
  const form = new FormData();
  form.append("file", blob, name);
  return api<Record<string, unknown>>(url, { method: "POST", body: form });
}

/** Bildschirm während des Hochladens anlassen (sonst bricht der Upload beim Sperren ab). */
async function keepAwake(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const lock = await nav.wakeLock?.request("screen");
    return () => void lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}

export function KneteForm() {
  const [settings, setSettings] = useState<KneteSettings | null>(null);
  const [defaults, setDefaults] = useState<KneteSettings | null>(null);
  const [keySet, setKeySet] = useState(true);
  const [refs, setRefs] = useState<string[]>([]);
  const [refBusy, setRefBusy] = useState(false);
  const [jobs, setJobs] = useState<KneteJobSummary[]>([]);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [folder, setFolder] = useState("");
  const [uploading, setUploading] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadJobs = useCallback(async () => {
    const r = await api<{ jobs: KneteJobSummary[]; keySet: boolean }>("/api/knete/jobs");
    setJobs(r.jobs);
    setKeySet(r.keySet);
    return r.jobs;
  }, []);

  useEffect(() => {
    api<{ settings: KneteSettings; defaults: KneteSettings; keySet: boolean }>("/api/knete/settings")
      .then((r) => {
        setSettings(r.settings);
        setDefaults(r.defaults);
        setKeySet(r.keySet);
      })
      .catch((e) => setError(String(e.message ?? e)));
    api<{ refs: string[] }>("/api/knete/refs")
      .then((r) => setRefs(r.refs))
      .catch(() => {});
  }, []);

  // Übersicht aktualisieren: schnell, solange etwas läuft
  useEffect(() => {
    let stop = false;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const list = await loadJobs().catch(() => jobs);
      if (stop) return;
      const active = list.some((j) => j.running + j.pending > 0 && !j.paused);
      t = setTimeout(tick, active ? 3000 : 15000);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadJobs]);

  const updateSettings = (patch: Partial<KneteSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api("/api/knete/settings", { method: "PUT", json: next }).catch((e) => setError(`Speichern fehlgeschlagen: ${e.message}`));
    }, 600);
  };

  const addRefs = async (files: FileList | null) => {
    if (!files?.length) return;
    setRefBusy(true);
    setError(null);
    try {
      for (const f of Array.from(files).slice(0, KNETE_MAX_REFS - refs.length)) {
        const r = (await upload("/api/knete/refs", await shrink(f, 1536), f.name)) as { refs: string[] };
        setRefs(r.refs);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefBusy(false);
    }
  };

  const removeRef = async (name: string) => {
    const r = await api<{ refs: string[] }>(`/api/knete/refs?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    setRefs(r.refs);
  };

  /** Fotos hochladen – jedes Foto geht sofort in die Warteschlange auf dem Server. */
  const uploadPhotos = async (jobId: string, files: File[]) => {
    const release = await keepAwake();
    let failed = 0;
    setUploading({ done: 0, total: files.length, failed: 0 });
    for (let n = 0; n < files.length; n++) {
      const f = files[n];
      try {
        await upload(`/api/knete/jobs/${jobId}/photos`, await shrink(f), f.name || `foto_${n + 1}.jpg`);
      } catch (e) {
        failed++;
        setError(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      setUploading({ done: n + 1, total: files.length, failed });
    }
    release();
    setUploading(null);
    loadJobs().catch(() => {});
  };

  const start = async () => {
    if (!photos.length) return;
    setError(null);
    try {
      const { job } = await api<{ job: KneteJob }>("/api/knete/jobs", { method: "POST", json: { folder } });
      setOpenJob(job.id);
      await loadJobs();
      const list = photos;
      setPhotos([]);
      await uploadPhotos(job.id, list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const busy = !!uploading;
  const canStart = keySet && refs.length > 0 && photos.length > 0 && !busy;

  return (
    <main className="page">
      <div className="px-1">
        <h1 className="text-lg font-semibold">Knete-Stil</h1>
        <p className="text-sm text-muted">Fotos 1:1 im Stil deiner Knete-Bilder neu erzeugen – über OpenAI, nicht über den Pod.</p>
      </div>

      {!keySet && (
        <WarnBox>
          <p className="font-semibold">OpenAI-Schlüssel fehlt</p>
          <p className="mt-1">
            Auf dem Server <code>bash /root/setup-server.sh openai</code> ausführen (bzw. auf dem Pod <code>OPENAI_API_KEY</code> im Template setzen). Der Schlüssel kommt von platform.openai.com → API keys, das ChatGPT-Abo zählt dafür nicht.
          </p>
        </WarnBox>
      )}
      {error && <ErrorBox focus>{error}</ErrorBox>}

      {/* 1. Referenzen */}
      <section className="card space-y-3 p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">1. Stil-Referenzen</h2>
          <span className="text-sm text-muted">
            {refs.length} / {KNETE_MAX_REFS}
          </span>
        </div>
        <p className="text-xs text-muted">3–6 deiner fertigen Knete-Bilder. Sie werden gespeichert und für alle neuen Aufträge benutzt.</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {refs.map((r) => (
            <div key={r} className="relative aspect-square overflow-hidden rounded-xl bg-bg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl({ kind: "ref", name: r, thumb: 1 })} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-sm"
                onClick={() => removeRef(r)}
                aria-label="Referenz entfernen"
              >
                ✕
              </button>
            </div>
          ))}
          {refs.length < KNETE_MAX_REFS && (
            <label className={`flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line text-sm text-muted ${refBusy ? "opacity-50" : ""}`}>
              <span className="text-2xl">{refBusy ? "⏳" : "＋"}</span>
              {refBusy ? "lädt …" : "Hinzufügen"}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={refBusy}
                onChange={(e) => {
                  addRefs(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </section>

      {/* Einstellungen */}
      {settings && (
        <Section title="Einstellungen" right={KNETE_MODELS.find((m) => m.value === settings.model)?.label.split(" –")[0] ?? settings.model}>
          <Field label="Modell">
            <Select value={settings.model} onChange={(v) => updateSettings({ model: v })} options={KNETE_MODELS.map((m) => ({ value: m.value, label: m.label }))} />
          </Field>
          <Field label="Qualität" hint="„Hoch“ trifft den Stil am besten, kostet aber am meisten.">
            <Segmented
              value={settings.quality}
              onChange={(v) => updateSettings({ quality: v })}
              options={[
                { value: "low", label: "Niedrig" },
                { value: "medium", label: "Mittel" },
                { value: "high", label: "Hoch" },
              ]}
            />
          </Field>
          <Field label="Größe" hint={`Seitenverhältnis wie das Foto, z. B. Hochformat 3:4 → ${outputSize(3, 4, settings.size)}`}>
            <Segmented
              value={settings.size}
              onChange={(v) => updateSettings({ size: v })}
              options={[
                { value: "1536", label: "1536 px" },
                { value: "2048", label: "2048 px" },
                { value: "auto", label: "Auto" },
              ]}
            />
          </Field>
          <Field label="Gleichzeitig" right={`${settings.concurrency} Bilder`} hint="Mehr = schneller fertig. Bei Fehlern „Rate-Limit“ kleiner stellen.">
            <Slider value={settings.concurrency} min={1} max={6} onChange={(v) => updateSettings({ concurrency: v })} />
          </Field>
          <Field
            label="Anweisung an das Modell"
            hint="Bild 1 ist immer dein Foto, danach kommen die Referenzen."
            right={
              defaults && settings.prompt !== defaults.prompt ? (
                <button type="button" className="text-accent" onClick={() => updateSettings({ prompt: defaults.prompt })}>
                  Standard
                </button>
              ) : undefined
            }
          >
            <textarea className="input min-h-56 font-mono text-sm" value={settings.prompt} onChange={(e) => updateSettings({ prompt: e.target.value })} />
          </Field>
        </Section>
      )}

      {/* 2. Fotos */}
      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">2. Fotos umwandeln</h2>
        <label className={`btn btn-ghost w-full ${busy ? "pointer-events-none opacity-50" : ""}`}>
          📷 Fotos auswählen
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              setPhotos(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </label>
        {photos.length > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span>{photos.length} Fotos ausgewählt</span>
            <button type="button" className="text-muted underline" onClick={() => setPhotos([])}>
              leeren
            </button>
          </div>
        )}
        <Field label="Ordner" hint={`Ergebnisse landen in der Galerie unter „knete/${folder.trim() ? folder.trim().replace(/[^A-Za-z0-9_-]+/g, "_") : "<Datum>"}“.`}>
          <input className="input" placeholder="leer = Datum und Uhrzeit" value={folder} onChange={(e) => setFolder(e.target.value)} />
        </Field>
        {uploading && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span>
                Hochladen {uploading.done} / {uploading.total}
              </span>
              {uploading.failed > 0 && <span className="text-red-300">{uploading.failed} fehlgeschlagen</span>}
            </div>
            <ProgressBar value={uploading.done} max={uploading.total} />
            <p className="text-xs text-muted">App bis zum Ende des Hochladens offen lassen. Danach rechnet der Server alleine weiter – auch wenn das Handy gesperrt ist.</p>
          </div>
        )}
      </section>

      {/* Aufträge */}
      {jobs.length > 0 && (
        <div className="space-y-3">
          <h2 className="px-1 font-semibold">Aufträge</h2>
          {jobs.map((j) => (
            <JobCard
              key={j.id}
              summary={j}
              open={openJob === j.id}
              onToggle={() => setOpenJob(openJob === j.id ? null : j.id)}
              onChanged={() => loadJobs().catch(() => {})}
              onAddPhotos={(files) => uploadPhotos(j.id, files)}
              uploading={busy}
            />
          ))}
        </div>
      )}

      <div className="sticky-action">
        <button type="button" className="btn btn-primary w-full shadow-lg" disabled={!canStart} onClick={start}>
          {busy
            ? `Hochladen ${uploading!.done} / ${uploading!.total} …`
            : !refs.length
              ? "Erst Referenzen hinzufügen"
              : photos.length
                ? `Umwandeln – ${photos.length} ${photos.length === 1 ? "Foto" : "Fotos"}`
                : "Fotos auswählen"}
        </button>
      </div>
    </main>
  );
}

const STATUS: Record<KneteItem["status"], string> = {
  pending: "⏳",
  running: "⚙️",
  done: "",
  error: "❌",
  cancelled: "⏹",
};

function JobCard({
  summary: s,
  open,
  onToggle,
  onChanged,
  onAddPhotos,
  uploading,
}: {
  summary: KneteJobSummary;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onAddPhotos: (files: File[]) => void;
  uploading: boolean;
}) {
  const [job, setJob] = useState<KneteJob | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const active = s.running + s.pending > 0 && !s.paused;
  const finished = s.done + s.errors + s.cancelled;

  const load = useCallback(async () => {
    const r = await api<{ job: KneteJob }>(`/api/knete/jobs/${s.id}`);
    setJob(r.job);
  }, [s.id]);

  // Details neu laden, sobald sich der Stand in der Übersicht ändert
  const stamp = `${s.total}/${s.done}/${s.errors}/${s.running}/${s.pending}/${s.cancelled}/${s.paused ?? ""}`;
  useEffect(() => {
    if (open) load().catch((e) => setErr(e.message));
  }, [open, load, stamp]);

  const action = async (a: string, i?: number) => {
    setErr(null);
    try {
      const r = await api<{ job: KneteJob }>(`/api/knete/jobs/${s.id}`, { method: "POST", json: { action: a, i } });
      setJob(r.job);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async () => {
    if (!confirm(`Auftrag „${s.folder}“ löschen? Fertige Bilder bleiben in der Galerie unter knete/${s.folder}.`)) return;
    await api(`/api/knete/jobs/${s.id}`, { method: "DELETE" });
    onChanged();
  };

  const avg = s.done ? s.costUsd / s.done : 0;

  return (
    <section className="card">
      <button type="button" className="w-full space-y-2 px-4 py-3.5 text-left" onClick={onToggle} aria-expanded={open}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold">knete/{s.folder}</span>
          <span className="shrink-0 text-sm text-muted">
            {s.done} / {s.total} fertig
          </span>
        </div>
        <ProgressBar value={finished} max={s.total || 1} />
        <div className="flex flex-wrap gap-x-3 text-xs text-muted">
          {s.running > 0 && <span>⚙️ {s.running} läuft</span>}
          {s.pending > 0 && <span>⏳ {s.pending} wartet</span>}
          {s.errors > 0 && <span className="text-red-300">❌ {s.errors} Fehler</span>}
          {s.cancelled > 0 && <span>⏹ {s.cancelled} abgebrochen</span>}
          {s.costUsd > 0 && (
            <span>
              ≈ {usd(s.costUsd)} ({usd(avg)}/Bild)
            </span>
          )}
        </div>
        {s.paused && <p className="text-sm text-amber-200">Angehalten: {s.paused}</p>}
      </button>

      {open && (
        <div className="space-y-3 border-t border-line px-4 py-4">
          {err && <ErrorBox>{err}</ErrorBox>}
          <div className="grid grid-cols-2 gap-2">
            {s.paused && (
              <button type="button" className="btn btn-primary col-span-2" onClick={() => action("resume")}>
                ▶ Fortsetzen
              </button>
            )}
            {active && (
              <button type="button" className="btn btn-danger" onClick={() => action("cancel")}>
                ⏹ Abbrechen
              </button>
            )}
            {s.errors + s.cancelled > 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => action("retry-failed")}>
                🔁 Fehler nochmal
              </button>
            )}
            {s.done > 0 && (
              <a className="btn btn-ghost" href={`/api/zip?folder=${encodeURIComponent(`knete/${s.folder}`)}`} download>
                📦 ZIP ({s.done})
              </a>
            )}
            <label className={`btn btn-ghost ${uploading ? "pointer-events-none opacity-50" : ""}`}>
              ＋ Fotos
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (files.length) onAddPhotos(files);
                }}
              />
            </label>
            <button type="button" className="btn btn-ghost" onClick={remove}>
              🗑 Löschen
            </button>
          </div>

          {job && (
            <>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {job.items.map((it, n) => (
                  <button key={it.i} type="button" className="relative aspect-square overflow-hidden rounded-xl bg-bg" onClick={() => setViewer(n)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={
                        it.status === "done" && it.output
                          ? fileUrl({ kind: "out", job: job.id, name: it.output, thumb: 1, v: it.updatedAt })
                          : fileUrl({ kind: "in", job: job.id, name: it.input, thumb: 1 })
                      }
                      alt=""
                      loading="lazy"
                      className={`h-full w-full object-cover ${it.status === "done" ? "" : "opacity-40"}`}
                    />
                    {it.status !== "done" && (
                      <span className={`absolute inset-0 flex items-center justify-center text-2xl ${it.status === "running" ? "animate-pulse" : ""}`}>{STATUS[it.status]}</span>
                    )}
                  </button>
                ))}
              </div>
              {job.items.some((x) => x.status === "error") && (
                <ul className="space-y-1 text-xs text-red-200">
                  {job.items
                    .filter((x) => x.status === "error")
                    .slice(0, 20)
                    .map((x) => (
                      <li key={x.i}>
                        {x.name}: {x.error}
                      </li>
                    ))}
                </ul>
              )}
              <p className="text-xs text-muted">
                {job.settings.model} · Qualität {job.settings.quality} · {job.refs.length} Referenzen
              </p>
            </>
          )}
        </div>
      )}

      {job && viewer !== null && job.items[viewer] && (
        <Viewer job={job} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} onRetry={(i) => action("retry", i)} />
      )}
    </section>
  );
}

function Viewer({ job, index, onIndex, onClose, onRetry }: { job: KneteJob; index: number; onIndex: (n: number) => void; onClose: () => void; onRetry: (i: number) => void }) {
  const it = job.items[index];
  const [before, setBefore] = useState(false);
  const touch = useRef<number | null>(null);
  const hasOut = it.status === "done" && !!it.output;
  const showBefore = before || !hasOut;
  const src = showBefore ? fileUrl({ kind: "in", job: job.id, name: it.input }) : fileUrl({ kind: "out", job: job.id, name: it.output, v: it.updatedAt });
  const go = (d: number) => {
    const n = index + d;
    if (n >= 0 && n < job.items.length) onIndex(n);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
        <span className="truncate text-soft">
          {index + 1} / {job.items.length} · {it.name}
        </span>
        <button type="button" className="btn btn-ghost min-h-10 px-3" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="max-h-full max-w-full object-contain" />
        {!hasOut && (
          <span className="absolute rounded-xl bg-black/70 px-4 py-2 text-sm">
            {it.status === "error" ? `❌ ${it.error}` : it.status === "running" ? "⚙️ wird erzeugt …" : it.status === "pending" ? "⏳ wartet" : "⏹ abgebrochen"}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 p-3">
        <button type="button" className="btn btn-ghost select-none" disabled={!hasOut} onContextMenu={(e) => e.preventDefault()} onPointerDown={() => setBefore(true)} onPointerUp={() => setBefore(false)} onPointerLeave={() => setBefore(false)} onClick={(e) => e.preventDefault()}>
          {showBefore ? "Vorher" : "👆 Vorher"}
        </button>
        {hasOut ? (
          <a className="btn btn-ghost" href={fileUrl({ kind: "out", job: job.id, name: it.output, download: 1 })} download>
            ⬇ Laden
          </a>
        ) : (
          <span />
        )}
        <button type="button" className="btn btn-ghost" disabled={it.status === "running" || it.status === "pending"} onClick={() => onRetry(it.i)}>
          🔁 Neu
        </button>
      </div>
    </div>
  );
}
