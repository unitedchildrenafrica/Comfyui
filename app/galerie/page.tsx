"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ComfyDown, ErrorBox, Segmented, Select } from "@/components/ui";
import { api, ApiError, viewUrl } from "@/lib/client";

interface Item {
  filename: string;
  subfolder: string;
  type: string;
  kind: "image" | "video";
  promptId: string;
  timestamp: number;
  folder: string;
  label: string;
  generator: string | null;
  seed: number | null;
  hasSettings: boolean;
}

export default function GalleryPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [kind, setKind] = useState<"all" | "image" | "video">("all");
  const [folder, setFolder] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const touch = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Item[] }>("/api/history?max=500")).items);
      setError(null);
    } catch (err) {
      setError(err as ApiError);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const folders = useMemo(() => [...new Set((items ?? []).map((i) => i.folder))].sort(), [items]);
  const shown = useMemo(() => (items ?? []).filter((i) => (kind === "all" || i.kind === kind) && (!folder || i.folder === folder)), [items, kind, folder]);
  const current = open !== null ? shown[open] : null;
  const step = (d: number) => setOpen((o) => (o === null ? o : Math.min(shown.length - 1, Math.max(0, o + d))));

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <main className="page">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-lg font-semibold">Galerie</h1>
        <button type="button" className="text-sm text-accent underline" onClick={load}>
          Aktualisieren
        </button>
      </div>
      {error && (error.comfyDown ? <ComfyDown onRetry={load} /> : <ErrorBox>{error.message}</ErrorBox>)}
      <Segmented
        value={kind}
        options={[
          { value: "all", label: "Alle" },
          { value: "image", label: "Bilder" },
          { value: "video", label: "Videos" },
        ]}
        onChange={setKind}
      />
      <Select value={folder} onChange={setFolder} options={[{ value: "", label: "Alle Ordner" }, ...folders]} />
      {items && !shown.length && <p className="px-1 text-sm text-muted">Noch keine Outputs.</p>}
      <div className="grid grid-cols-3 gap-1.5">
        {shown.map((it, i) => (
          <button key={it.promptId + it.subfolder + it.filename} type="button" className="relative aspect-square overflow-hidden rounded-lg bg-card" onClick={() => setOpen(i)}>
            {it.kind === "video" ? (
              <>
                <video src={viewUrl(it) + "#t=0.1"} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-xs">▶</span>
              </>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewUrl(it, { preview: "webp;60" })} alt={it.label} loading="lazy" className="h-full w-full object-cover" />
            )}
          </button>
        ))}
      </div>

      {current && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
          onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (touch.current === null) return;
            const dx = e.changedTouches[0].clientX - touch.current;
            if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
            touch.current = null;
          }}
        >
          <div className="flex items-center justify-between gap-2 p-3 text-sm">
            <span className="min-w-0 truncate">
              {current.label}
              {current.seed !== null && <span className="text-muted"> · Seed {current.seed}</span>}
            </span>
            <button type="button" className="btn btn-ghost px-3" onClick={() => setOpen(null)} aria-label="Schließen">
              ✕
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {current.kind === "video" ? (
              <video key={current.filename} src={viewUrl(current)} controls playsInline autoPlay className="max-h-full max-w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewUrl(current)} alt={current.label} className="max-h-full max-w-full object-contain" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 p-3">
            <a className="btn btn-ghost" href={viewUrl(current, { download: "1" })}>
              Download
            </a>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!current.hasSettings}
              onClick={() => router.push(`/${current.kind === "video" ? "video" : "bild"}?from=${current.promptId}`)}
            >
              Einstellungen übernehmen
            </button>
          </div>
          <p className="pb-2 text-center text-xs text-muted">
            {open! + 1} / {shown.length} · wischen zum Blättern
          </p>
        </div>
      )}
    </main>
  );
}
