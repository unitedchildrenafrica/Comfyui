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
  // Verwalten: Auswahl zum Herunterladen/Löschen
  const [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [manageMsg, setManageMsg] = useState<string | null>(null);
  const zipForm = useRef<HTMLFormElement>(null);

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
  const loadFavs = useCallback(() => {
    api<{ items: Item[] }>("/api/favorites")
      .then((r) => setFavs(r.items))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    loadFavs();
  }, [load, loadFavs]);

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
  const loadZipInfo = useCallback(() => {
    setZipInfo(null);
    api<{ files: number; bytes: number }>(`/api/zip?info=1&folder=${encodeURIComponent(folder)}`)
      .then(setZipInfo)
      .catch(() => {});
  }, [folder]);
  useEffect(loadZipInfo, [loadZipInfo]);
  const shown = useMemo(
    () =>
      kind === "fav"
        ? favs
        : (items ?? []).filter((i) => (kind === "all" || i.kind === kind) && (!folder || i.subfolder === folder || i.subfolder.startsWith(folder + "/"))),
    [items, kind, folder, favs],
  );
  const current = open !== null ? shown[open] : null;

  // --- Verwalten ------------------------------------------------------------------------
  const selectedItems = shown.filter((i) => selected.has(keyOf(i)));
  const toggleSelect = (it: Item) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(keyOf(it))) next.delete(keyOf(it));
      else next.add(keyOf(it));
      return next;
    });
  const endManage = () => {
    setManage(false);
    setSelected(new Set());
    setManageMsg(null);
  };
  const forget = (gone: { filename: string; subfolder: string }[]) => {
    const keys = new Set(gone.map(keyOf));
    setItems((list) => (list ?? []).filter((i) => !keys.has(keyOf(i))));
    // Favoriten bleiben erhalten (liegen jetzt im Favoriten-Speicher)
    loadFavs();
    setSelected(new Set());
  };
  const downloadSelected = () => {
    if (!selectedItems.length) return;
    if (selectedItems.length === 1) {
      const a = document.createElement("a");
      a.href = viewUrl(selectedItems[0], { download: "1" });
      a.download = selectedItems[0].filename;
      a.click();
      return;
    }
    // Formular-POST: Der Browser lädt die ZIP selbst herunter (auch große Auswahl, auch am iPhone)
    const form = zipForm.current!;
    (form.elements.namedItem("files") as HTMLInputElement).value = JSON.stringify(
      selectedItems.map((i) => ({ filename: i.filename, subfolder: i.subfolder })),
    );
    form.submit();
  };
  const deleteSelected = async () => {
    const list = selectedItems.map((i) => ({ filename: i.filename, subfolder: i.subfolder }));
    const favCount = selectedItems.filter((i) => favKeys.has(keyOf(i))).length;
    const favNote = favCount ? `\n\n${favCount} davon ${favCount === 1 ? "ist ein Favorit und bleibt" : "sind Favoriten und bleiben"} unter ⭐ erhalten.` : "";
    if (!list.length || !window.confirm(`${list.length} ${list.length === 1 ? "Datei" : "Dateien"} wirklich löschen?${favNote}`)) return;
    setBusy(true);
    setManageMsg(null);
    try {
      const r = await api<{ deleted: number; failed: string[]; keptFavorites?: number }>("/api/files", { method: "POST", json: { action: "delete", files: list } });
      forget(list);
      setManageMsg(
        `${r.deleted} gelöscht${r.keptFavorites ? ` · ${r.keptFavorites === 1 ? "1 Favorit bleibt" : `${r.keptFavorites} Favoriten bleiben`} unter ⭐` : ""}${r.failed.length ? ` · ${r.failed.length} fehlgeschlagen: ${r.failed[0]}` : ""}`,
      );
      loadZipInfo();
    } catch (err) {
      setManageMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const deleteFolderAll = async () => {
    const what = folder ? `den Ordner „${folder}“` : "die GANZE Galerie (alle Ordner)";
    const n = zipInfo?.files ?? 0;
    const typed = window.prompt(
      `Damit löschst du ${what} – ${n} Dateien, Bilder und Videos. Das lässt sich nicht rückgängig machen. Favoriten bleiben unter ⭐ erhalten.\n\nZum Bestätigen LÖSCHEN eintippen:`,
    );
    if (typed?.trim().toUpperCase() !== "LÖSCHEN") return;
    setBusy(true);
    setManageMsg(null);
    try {
      const r = await api<{ deleted: number; failed: string[]; keptFavorites?: number }>("/api/files", {
        method: "POST",
        json: { action: "delete-folder", folder, all: !folder },
      });
      setManageMsg(
        `${r.deleted} ${r.deleted === 1 ? "Datei" : "Dateien"} gelöscht${r.keptFavorites ? ` · ${r.keptFavorites === 1 ? "1 Favorit bleibt" : `${r.keptFavorites} Favoriten bleiben`} unter ⭐` : ""}${r.failed.length ? ` · ${r.failed.length} fehlgeschlagen` : ""}`,
      );
      setSelected(new Set());
      setFolder("");
      await load();
      api<{ folders: string[] }>("/api/zip?list=1")
        .then((x) => setDiskFolders(x.folders))
        .catch(() => {});
      loadFavs();
    } catch (err) {
      setManageMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
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
        <span className="flex items-center gap-3">
          {kind !== "fav" && (
            <button type="button" className={`btn min-h-9 px-3 text-sm ${manage ? "btn-primary" : "btn-ghost"}`} onClick={() => (manage ? endManage() : setManage(true))}>
              {manage ? "Fertig" : "Verwalten"}
            </button>
          )}
          <button type="button" className="text-sm text-accent underline" onClick={load}>
            Aktualisieren
          </button>
        </span>
      </div>
      <form ref={zipForm} method="post" action="/api/zip" className="hidden">
        <input type="hidden" name="files" />
      </form>
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
          if (v === "fav") endManage();
        }}
      />
      {kind !== "fav" && <Select value={folder} onChange={setFolder} options={[{ value: "", label: "Alle Ordner" }, ...folders]} />}
      {manage && (
        <section className="card space-y-2 p-3">
          <p className="text-sm text-muted">Bilder antippen zum Auswählen. Unten herunterladen oder löschen.</p>
          {canDelete && zipInfo && zipInfo.files > 0 && (
            <button type="button" className="btn btn-danger w-full" disabled={busy} onClick={deleteFolderAll}>
              🗑 {folder ? `Ordner „${folder}“ löschen` : "Ganze Galerie löschen"} ({zipInfo.files} {zipInfo.files === 1 ? "Datei" : "Dateien"})
            </button>
          )}
          {manageMsg && <p className="text-sm text-soft">{manageMsg}</p>}
        </section>
      )}
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
          <button
            type="button"
            className={`relative block aspect-square w-full overflow-hidden ${manage && selected.has(keyOf(it)) ? "ring-4 ring-inset ring-accent" : ""}`}
            onClick={() => (manage ? toggleSelect(it) : setOpen(i))}
          >
            {favKeys.has(keyOf(it)) && kind !== "fav" && <span className="absolute left-1 top-1 z-10 text-sm drop-shadow">⭐</span>}
            {manage && (
              <span
                className={`absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold ${selected.has(keyOf(it)) ? "border-accent bg-accent text-white" : "border-white/80 bg-black/40"}`}
                aria-hidden
              >
                {selected.has(keyOf(it)) ? "✓" : ""}
              </span>
            )}
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

      {manage && (
        <div className="sticky-action">
          <div className="card flex items-center gap-2 p-2 shadow-lg shadow-black/40">
            <button
              type="button"
              className="btn btn-ghost min-h-11 px-3 text-sm"
              onClick={() => setSelected(selectedItems.length === shown.length ? new Set() : new Set(shown.map(keyOf)))}
            >
              {selectedItems.length === shown.length && shown.length ? "Keine" : "Alle"}
            </button>
            <span className="min-w-0 flex-1 text-sm">{selectedItems.length} ausgewählt</span>
            <button type="button" className="btn btn-ghost min-h-11 px-3" disabled={!selectedItems.length || busy} onClick={downloadSelected} aria-label="Herunterladen">
              ⬇{selectedItems.length > 1 ? " ZIP" : ""}
            </button>
            {canDelete && (
              <button type="button" className="btn btn-danger min-h-11 px-3" disabled={!selectedItems.length || busy} onClick={deleteSelected} aria-label="Löschen">
                {busy ? "…" : "🗑"}
              </button>
            )}
          </div>
        </div>
      )}

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
              <video key={current.promptId + current.filename} src={viewUrl(current)} controls playsInline autoPlay className="max-h-full max-w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewUrl(current)} alt={current.label} className="max-h-full max-w-full object-contain" />
            )}
          </div>
          {deleteError && <p className="px-3 text-center text-sm text-red-300">{deleteError}</p>}
          <div className={`grid gap-2 p-3 ${canDelete || kind === "fav" ? "grid-cols-[auto_1fr_1fr]" : "grid-cols-2"}`}>
            {kind === "fav" && (
              <button
                type="button"
                className="btn btn-danger px-3"
                aria-label="Aus Favoriten löschen"
                onClick={() => {
                  const onlyHere = current.type === "favorite";
                  if (
                    !window.confirm(
                      onlyHere
                        ? `„${current.filename}“ aus den Favoriten löschen? Es ist nur noch hier gespeichert und danach endgültig weg.`
                        : `„${current.filename}“ aus den Favoriten entfernen? In der Galerie bleibt es.`,
                    )
                  )
                    return;
                  const gone = current;
                  saveFavs(favs.filter((f) => keyOf(f) !== keyOf(gone)));
                  setOpen((o) => (o === null || shown.length <= 1 ? null : Math.min(o, shown.length - 2)));
                }}
              >
                🗑
              </button>
            )}
            {canDelete && kind !== "fav" && (
              <button
                type="button"
                className="btn btn-danger px-3"
                aria-label="Löschen"
                onClick={async () => {
                  const isFav = favKeys.has(keyOf(current));
                  if (!window.confirm(`„${current.filename}“ wirklich löschen?${isFav ? "\n\nEs ist ein Favorit und bleibt unter ⭐ erhalten." : ""}`)) return;
                  setDeleteError(null);
                  try {
                    await api(`/api/files?${new URLSearchParams({ filename: current.filename, subfolder: current.subfolder })}`, { method: "DELETE" });
                    const gone = current;
                    setItems((list) => (list ?? []).filter((i) => !(i.filename === gone.filename && i.subfolder === gone.subfolder)));
                    loadFavs();
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
