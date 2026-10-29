"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ComfyDown, ErrorBox, Segmented, Select } from "@/components/ui";
import { api, ApiError, viewUrl } from "@/lib/client";
import { formatDuration } from "@/lib/format";

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
  durationMs: number | null;
}

export default function GalleryPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [kind, setKind] = useState<"all" | "image" | "video" | "fav">("all");
  const [favs, setFavs] = useState<Item[]>([]);
  const [folder, setFolder] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [canDelete, setCanDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const touch = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Item[]; canDelete?: boolean }>("/api/history?max=500");
      setItems(r.items);
      setCanDelete(!!r.canDelete);
      setError(null);
    } catch (err) {
      setError(err as ApiError);
    }
  }, []);
  useEffect(() => {
    load();
    api<{ items: Item[] }>("/api/favorites")
      .then((r) => setFavs(r.items))
      .catch(() => {});
  }, [load]);

  // --- Favoriten: geordnete Liste, wird komplett auf dem Pod gespeichert ---------------
  const keyOf = (f: { filename: string; subfolder: string }) => `${f.subfolder}/${f.filename}`;
  const favKeys = useMemo(() => new Set(favs.map(keyOf)), [favs]);
  const saveFavs = (next: Item[]) => {
    setFavs(next);
    api("/api/favorites", { method: "PUT", json: { items: next } }).catch(() => {});
  };
  const toggleFav = (it: Item) =>
    saveFavs(favKeys.has(keyOf(it)) ? favs.filter((f) => keyOf(f) !== keyOf(it)) : [it, ...favs]);
  const moveFav = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= favs.length) return;
    const next = [...favs];
    [next[index], next[j]] = [next[j], next[index]];
    saveFavs(next);
  };

  const [diskFolders, setDiskFolders] = useState<string[]>([]);
  const [zipInfo, setZipInfo] = useState<{ files: number; bytes: number } | null>(null);
  const folders = useMemo(
    () => [...new Set([...(items ?? []).map((i) => i.folder).filter((f) => f !== "(ohne)"), ...diskFolders])].sort(),
    [items, diskFolders],
  );

  useEffect(() => {
    api<{ folders: string[] }>("/api/zip?list=1")
      .then((r) => setDiskFolders(r.folders))
      .catch(() => {});
  }, []);

  // Anzahl/Größe für den ZIP-Knopf (direkt vom Ausgabeordner, also auch alte Batches)
  useEffect(() => {
    setZipInfo(null);
    api<{ files: number; bytes: number }>(`/api/zip?info=1&folder=${encodeURIComponent(folder)}`)
      .then(setZipInfo)
      .catch(() => {});
  }, [folder]);
  const shown = useMemo(
    () =>
      kind === "fav"
        ? favs
        : (items ?? []).filter((i) => (kind === "all" || i.kind === kind) && (!folder || i.subfolder === folder || i.subfolder.startsWith(folder + "/"))),
    [items, kind, folder, favs],
  );
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
          { value: "fav", label: `⭐ ${favs.length || ""}`.trim() },
        ]}
        onChange={(v) => {
          setKind(v);
          setOpen(null);
        }}
      />
      {kind !== "fav" && <Select value={folder} onChange={setFolder} options={[{ value: "", label: "Alle Ordner" }, ...folders]} />}
      {kind === "fav" && (
        <p className="px-1 text-xs text-muted">
          {favs.length ? "Mit ◀ ▶ die Reihenfolge ändern. Im Vollbild mit ⭐ hinzufügen oder entfernen." : "Noch keine Favoriten – im Vollbild auf ☆ tippen."}
        </p>
      )}
      {kind !== "fav" && zipInfo && zipInfo.files > 0 && (
        <a className="btn btn-ghost w-full" href={`/api/zip?folder=${encodeURIComponent(folder)}`} download>
          📦 {folder ? `Ordner „${folder}“` : "Alles"} als ZIP ({zipInfo.files} Dateien, {zipInfo.bytes >= 1e9 ? `${(zipInfo.bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(zipInfo.bytes / 1e6))} MB`})
        </a>
      )}
      {items && kind !== "fav" && !shown.length && <p className="px-1 text-sm text-muted">Noch keine Outputs.</p>}
      <div className="grid grid-cols-3 gap-1.5">
        {shown.map((it, i) => (
          <div key={it.promptId + it.subfolder + it.filename} className="overflow-hidden rounded-lg bg-card">
          <button type="button" className="relative block aspect-square w-full overflow-hidden" onClick={() => setOpen(i)}>
            {favKeys.has(keyOf(it)) && kind !== "fav" && <span className="absolute left-1 top-1 z-10 text-sm drop-shadow">⭐</span>}
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
          {kind === "fav" && (
            <div className="flex items-center justify-between bg-black/60 text-sm">
              <button type="button" className="px-3 py-2 disabled:opacity-30" disabled={i === 0} onClick={() => moveFav(i, -1)} aria-label="nach vorne">
                ◀
              </button>
              <span className="text-xs text-muted">{i + 1}</span>
              <button type="button" className="px-3 py-2 disabled:opacity-30" disabled={i === shown.length - 1} onClick={() => moveFav(i, 1)} aria-label="nach hinten">
                ▶
              </button>
            </div>
          )}
          </div>
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
              {current.durationMs !== null && <span className="text-muted"> · ⏱ {formatDuration(current.durationMs)}</span>}
            </span>
            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                className={`btn px-3 ${favKeys.has(keyOf(current)) ? "border border-amber-400/60 bg-amber-400/15" : "btn-ghost"}`}
                onClick={() => toggleFav(current)}
                aria-label={favKeys.has(keyOf(current)) ? "Aus Favoriten entfernen" : "Zu Favoriten"}
              >
                {favKeys.has(keyOf(current)) ? "⭐" : "☆"}
              </button>
              <button type="button" className="btn btn-ghost px-3" onClick={() => setOpen(null)} aria-label="Schließen">
                ✕
              </button>
            </span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {current.kind === "video" ? (
              <video key={current.filename} src={viewUrl(current)} controls playsInline autoPlay className="max-h-full max-w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewUrl(current)} alt={current.label} className="max-h-full max-w-full object-contain" />
            )}
          </div>
          {deleteError && <p className="px-3 text-center text-sm text-red-300">{deleteError}</p>}
          <div className={`grid gap-2 p-3 ${canDelete ? "grid-cols-[auto_1fr_1fr]" : "grid-cols-2"}`}>
            {canDelete && (
              <button
                type="button"
                className="btn btn-danger px-3"
                aria-label="Löschen"
                onClick={async () => {
                  if (!window.confirm(`„${current.filename}“ wirklich vom Pod löschen?`)) return;
                  setDeleteError(null);
                  try {
                    await api(`/api/files?${new URLSearchParams({ filename: current.filename, subfolder: current.subfolder })}`, { method: "DELETE" });
                    const gone = current;
                    setItems((list) => (list ?? []).filter((i) => !(i.filename === gone.filename && i.subfolder === gone.subfolder)));
                    setFavs((list) => list.filter((f) => keyOf(f) !== keyOf(gone)));
                    // beim nächsten Bild bleiben bzw. schließen, wenn es das letzte war
                    setOpen((o) => (o === null || shown.length <= 1 ? null : Math.min(o, shown.length - 2)));
                  } catch (err) {
                    setDeleteError((err as Error).message);
                  }
                }}
              >
                🗑
              </button>
            )}
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
