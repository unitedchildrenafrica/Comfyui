"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/client";
import { CHUNK_BYTES, type PhotoFile, type PhotoFolder, cleanFolderName, photoKind } from "@/lib/photos";

const fileUrl = (folder: string, name: string, extra: Record<string, string> = {}) =>
  `/api/photos/file?${new URLSearchParams({ folder, name, ...extra })}`;

const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

interface UploadItem {
  key: string;
  file: File;
  sent: number;
  state: "wait" | "up" | "done" | "error";
  error?: string;
}

/** Ein Stück per XHR hochladen (fetch kennt keinen Upload-Fortschritt) */
function putChunk(url: string, blob: Blob, onProgress: (n: number) => void): Promise<{ done: boolean; received: number; name?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let data: { error?: string } & { done: boolean; received: number; name?: string };
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        return reject(new Error(xhr.status === 413 ? "Zu groß für den Server" : `HTTP ${xhr.status}`));
      }
      if (xhr.status >= 400) return reject(new Error(data.error ?? `HTTP ${xhr.status}`));
      resolve(data);
    };
    xhr.onerror = () => reject(new Error("Verbindung unterbrochen"));
    xhr.send(blob);
  });
}

async function uploadFile(folder: string, file: File, onSent: (n: number) => void): Promise<string> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  let offset = 0;
  let tries = 0;
  for (;;) {
    const end = Math.min(file.size, offset + CHUNK_BYTES);
    const url = `/api/photos/upload?${new URLSearchParams({ folder, name: file.name, id, offset: String(offset), total: String(file.size), mtime: String(file.lastModified || "") })}`;
    try {
      const r = await putChunk(url, file.slice(offset, end), (n) => onSent(offset + n));
      tries = 0;
      if (r.done) return r.name ?? file.name;
      offset = r.received;
      onSent(offset);
    } catch (err) {
      // Netz am Handy wackelt: dasselbe Stück bis zu 3-mal neu versuchen
      if (++tries > 3) throw err;
      await new Promise((r) => setTimeout(r, 1500 * tries));
    }
  }
}

function readFolderFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("ordner");
}

export default function PhotosPage() {
  const [folder, setFolderState] = useState<string | null>(null);
  const [folders, setFolders] = useState<PhotoFolder[] | null>(null);
  const [files, setFiles] = useState<PhotoFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const touch = useRef<number | null>(null);
  const uploading = useRef(false);
  /** Dateien, die während eines laufenden Uploads dazukommen */
  const pending = useRef<{ target: string; item: UploadItem }[]>([]);

  // Ordner steht in der Adresse (?ordner=…), damit „Zurück“ am Handy funktioniert
  const setFolder = (f: string | null, push = true) => {
    setFolderState(f);
    setFiles(null);
    setOpen(null);
    setSelecting(false);
    setSelected(new Set());
    if (push) window.history.pushState(null, "", f ? `/fotos?ordner=${encodeURIComponent(f)}` : "/fotos");
  };
  useEffect(() => {
    setFolderState(readFolderFromUrl());
    const onPop = () => {
      setFolderState(readFolderFromUrl());
      setFiles(null);
      setOpen(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      setFolders((await api<{ folders: PhotoFolder[] }>("/api/photos")).folders);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }, []);
  const loadFiles = useCallback(async (f: string) => {
    try {
      setFiles((await api<{ files: PhotoFile[] }>(`/api/photos?folder=${encodeURIComponent(f)}`)).files);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }, []);
  useEffect(() => {
    setError(null);
    if (folder) loadFiles(folder);
    else loadFolders();
  }, [folder, loadFiles, loadFolders]);

  const act = async (json: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      return await api<{ name?: string; deleted?: number }>("/api/photos", { method: "POST", json });
    } catch (err) {
      setError((err as ApiError).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const createFolder = async () => {
    const name = cleanFolderName(newName ?? "");
    if (!name) return setError("Bitte einen Namen eingeben (Buchstaben, Zahlen, Leerzeichen, - _ . ( ))");
    const r = await act({ action: "mkdir", name });
    if (r?.name) {
      setNewName(null);
      setFolder(r.name);
    }
  };
  const rename = async () => {
    if (!folder) return;
    const name = window.prompt("Neuer Name für den Ordner:", folder);
    if (!name || name === folder) return;
    const r = await act({ action: "rename", folder, name });
    if (r?.name) {
      setFolderState(r.name);
      window.history.replaceState(null, "", `/fotos?ordner=${encodeURIComponent(r.name)}`);
    }
  };
  const removeFolder = async () => {
    if (!folder) return;
    const n = files?.length ?? 0;
    if (!window.confirm(n ? `Ordner „${folder}“ mit ${n} ${n === 1 ? "Datei" : "Dateien"} endgültig löschen?` : `Leeren Ordner „${folder}“ löschen?`)) return;
    if (n && window.prompt(`Zur Sicherheit „LÖSCHEN“ eintippen:`) !== "LÖSCHEN") return;
    if (await act({ action: "rmdir", folder })) setFolder(null);
  };
  const removeFiles = async (names: string[]) => {
    if (!folder || !names.length) return;
    if (!window.confirm(`${names.length} ${names.length === 1 ? "Datei" : "Dateien"} endgültig löschen?`)) return;
    if (await act({ action: "delete", folder, files: names })) {
      setSelected(new Set());
      setSelecting(false);
      setOpen(null);
      loadFiles(folder);
    }
  };

  // Hochladen: Datei für Datei, jede in Stücken
  const addFiles = (list: FileList | null) => {
    if (!folder || !list?.length) return;
    const target = folder;
    const items: UploadItem[] = [...list].map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
      file,
      sent: 0,
      state: photoKind(file.name) || file.type.startsWith("image/") || file.type.startsWith("video/") ? "wait" : "error",
      error: photoKind(file.name) ? undefined : "kein Bild/Video",
    }));
    setUploads((u) => [...u.filter((x) => x.state !== "done"), ...items]);
    if (fileInput.current) fileInput.current.value = "";
    run(target, items);
  };
  const run = async (target: string, items: UploadItem[]) => {
    if (uploading.current) {
      // läuft schon – neue Einträge werden dort mit abgearbeitet
      pending.current.push(...items.map((i) => ({ target, item: i })));
      return;
    }
    uploading.current = true;
    const queue = [...items.map((i) => ({ target, item: i })), ...pending.current.splice(0)];
    while (queue.length) {
      const { target: t, item } = queue.shift()!;
      if (item.state !== "wait") continue;
      const patch = (p: Partial<UploadItem>) => setUploads((u) => u.map((x) => (x.key === item.key ? { ...x, ...p } : x)));
      patch({ state: "up" });
      try {
        await uploadFile(t, item.file, (n) => patch({ sent: n }));
        patch({ state: "done", sent: item.file.size });
      } catch (err) {
        patch({ state: "error", error: (err as Error).message });
      }
      queue.push(...pending.current.splice(0));
    }
    uploading.current = false;
    if (readFolderFromUrl() === target) loadFiles(target);
  };
  const active = uploads.filter((u) => u.state === "wait" || u.state === "up");
  const totalBytes = uploads.reduce((s, u) => s + u.file.size, 0);
  const sentBytes = uploads.reduce((s, u) => s + (u.state === "done" ? u.file.size : u.sent), 0);
  const current = open !== null && files ? files[open] : null;
  const step = (d: number) => setOpen((o) => (o === null || !files ? o : Math.min(files.length - 1, Math.max(0, o + d))));

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

  // ---------- Ordnerübersicht ----------
  if (!folder) {
    return (
      <main className="page">
        <div className="flex items-center justify-between px-1">
          <h1 className="text-lg font-semibold">Fotos</h1>
          <button type="button" className="text-sm text-accent underline" onClick={loadFolders}>
            Aktualisieren
          </button>
        </div>
        <p className="px-1 text-sm text-muted">Eigene Bilder und Videos, sortiert in eigene Ordner. Liegt auf dem Server und bleibt, auch wenn Pods wechseln.</p>
        {error && <ErrorBox>{error}</ErrorBox>}

        {newName === null ? (
          <button type="button" className="btn btn-primary w-full" onClick={() => setNewName("")}>
            ＋ Neuer Ordner
          </button>
        ) : (
          <form
            className="card flex gap-2 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              createFolder();
            }}
          >
            <input className="input min-w-0 flex-1" autoFocus placeholder="Name, z. B. Urlaub 2026" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} />
            <button type="submit" className="btn btn-primary px-4" disabled={busy}>
              Anlegen
            </button>
            <button type="button" className="btn btn-ghost px-3" onClick={() => setNewName(null)} aria-label="Abbrechen">
              ✕
            </button>
          </form>
        )}

        {folders === null && !error && <p className="px-1 text-sm text-muted">Lade …</p>}
        {folders?.length === 0 && <p className="px-1 text-sm text-muted">Noch keine Ordner. Leg oben einen an und lade dann Fotos oder Videos hoch.</p>}
        <ul className="grid grid-cols-2 gap-3">
          {folders?.map((f) => (
            <li key={f.name}>
              <button type="button" className="card block w-full overflow-hidden text-left" onClick={() => setFolder(f.name)}>
                <div className="flex aspect-square items-center justify-center bg-bg">
                  {f.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl(f.name, f.cover, { thumb: "1" })} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-4xl" aria-hidden>
                      📁
                    </span>
                  )}
                </div>
                <div className="p-2">
                  <p className="truncate font-medium">{f.name}</p>
                  <p className="text-xs text-muted">
                    {f.count} {f.count === 1 ? "Datei" : "Dateien"}
                    {f.bytes ? ` · ${size(f.bytes)}` : ""}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  // ---------- Ordner ----------
  return (
    <main className="page">
      <div className="flex items-center justify-between gap-2 px-1">
        <button type="button" className="text-sm text-accent underline" onClick={() => setFolder(null)}>
          ← Ordner
        </button>
        <span className="flex gap-3 text-sm">
          {!!files?.length && (
            <button type="button" className="text-accent underline" onClick={() => (selecting ? (setSelecting(false), setSelected(new Set())) : setSelecting(true))}>
              {selecting ? "Fertig" : "Auswählen"}
            </button>
          )}
        </span>
      </div>
      <h1 className="break-words px-1 text-lg font-semibold">📁 {folder}</h1>
      {error && <ErrorBox>{error}</ErrorBox>}

      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />
      <button type="button" className="btn btn-primary h-14 w-full text-lg" onClick={() => fileInput.current?.click()}>
        ＋ Fotos / Videos hochladen
      </button>

      {uploads.length > 0 && (
        <section className="card space-y-2 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span>
              {active.length ? `Lädt hoch … ${uploads.filter((u) => u.state === "done").length} / ${uploads.length}` : `✓ ${uploads.filter((u) => u.state === "done").length} hochgeladen`}
            </span>
            {!active.length && (
              <button type="button" className="text-xs text-accent underline" onClick={() => setUploads([])}>
                ausblenden
              </button>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-bg">
            <div className="h-full bg-accent transition-all" style={{ width: `${totalBytes ? Math.round((sentBytes / totalBytes) * 100) : 0}%` }} />
          </div>
          {active.length > 0 && <p className="text-xs text-muted">Seite offen lassen, bis alles oben ist.</p>}
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
            {uploads
              .filter((u) => u.state !== "done")
              .map((u) => (
                <li key={u.key} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">{u.file.name}</span>
                  <span className={u.state === "error" ? "shrink-0 text-red-300" : "shrink-0 text-muted"}>
                    {u.state === "error" ? `✗ ${u.error}` : u.state === "up" ? `${Math.round((u.sent / Math.max(1, u.file.size)) * 100)} %` : "wartet"}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {files === null && !error && <p className="px-1 text-sm text-muted">Lade …</p>}
      {files?.length === 0 && <p className="px-1 text-sm text-muted">Noch leer. Tippe oben auf „Hochladen“.</p>}

      <ul className="grid grid-cols-3 gap-1">
        {files?.map((f, i) => {
          const isSel = selected.has(f.name);
          return (
            <li key={f.name} className="relative aspect-square overflow-hidden rounded-lg bg-bg">
              <button
                type="button"
                className={`block h-full w-full ${isSel ? "opacity-60" : ""}`}
                onClick={() =>
                  selecting
                    ? setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(f.name)) n.delete(f.name);
                        else n.add(f.name);
                        return n;
                      })
                    : setOpen(i)
                }
                aria-label={f.name}
              >
                {f.kind === "video" ? (
                  <video src={`${fileUrl(folder, f.name)}#t=0.1`} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileUrl(folder, f.name, { thumb: "1" })} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
              </button>
              {f.kind === "video" && <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1 text-xs">▶</span>}
              {selecting && (
                <span className={`pointer-events-none absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs ${isSel ? "border-accent bg-accent text-white" : "border-white/80 bg-black/30"}`}>
                  {isSel ? "✓" : ""}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {!!files?.length && !selecting && (
        <div className="flex flex-wrap gap-2 pt-2">
          <a className="btn btn-ghost flex-1" href={`/api/photos/zip?folder=${encodeURIComponent(folder)}`} download>
            📦 Ordner als ZIP
          </a>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-2">
        <button type="button" className="btn btn-ghost flex-1" disabled={busy} onClick={rename}>
          ✏️ Umbenennen
        </button>
        <button type="button" className="btn btn-danger flex-1" disabled={busy} onClick={removeFolder}>
          🗑 Ordner löschen
        </button>
      </div>

      {selecting && (
        <div className="sticky-action">
          <div className="card flex items-center gap-2 p-2 shadow-lg shadow-black/40">
            <button
              type="button"
              className="btn btn-ghost min-h-11 px-3 text-sm"
              onClick={() => setSelected(files && selected.size === files.length ? new Set() : new Set(files?.map((f) => f.name)))}
            >
              {files && selected.size === files.length ? "Keine" : "Alle"}
            </button>
            <span className="min-w-0 flex-1 text-sm">{selected.size} ausgewählt</span>
            <button type="button" className="btn btn-danger min-h-11 px-3" disabled={!selected.size || busy} onClick={() => removeFiles([...selected])} aria-label="Löschen">
              🗑
            </button>
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
              {current.name}
              <span className="text-muted">
                {" "}
                · {open! + 1}/{files!.length} · {size(current.size)}
              </span>
            </span>
            <button type="button" className="btn btn-ghost shrink-0 px-3" onClick={() => setOpen(null)} aria-label="Schließen">
              ✕
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {current.kind === "video" ? (
              <video key={current.name} src={fileUrl(folder, current.name)} controls playsInline autoPlay className="max-h-full max-w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={current.name} src={fileUrl(folder, current.name)} alt={current.name} className="max-h-full max-w-full object-contain" />
            )}
          </div>
          <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 p-3">
            <button type="button" className="btn btn-ghost px-4" disabled={open === 0} onClick={() => step(-1)} aria-label="Vorheriges">
              ◀
            </button>
            <a className="btn btn-ghost" href={fileUrl(folder, current.name, { download: "1" })} download={current.name}>
              ⬇ Laden
            </a>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => removeFiles([current.name])}>
              🗑 Löschen
            </button>
            <button type="button" className="btn btn-ghost px-4" disabled={open === files!.length - 1} onClick={() => step(1)} aria-label="Nächstes">
              ▶
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
