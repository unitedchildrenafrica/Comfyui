"use client";

import { useRef, useState } from "react";
import { viewUrl } from "@/lib/client";
import { H3_MAX_AUDIO, H3_MAX_IMAGES, H3_MAX_VIDEOS } from "@/lib/builders/h3";
import { type VideoMode, refHasSound, refTag, refWarnings, usedSeconds, videoMode } from "@/lib/h3refs";
import type { H3Ref } from "@/lib/types";
import { ErrorBox, NumberInput, WarnBox } from "@/components/ui";

// Breiter Filter: Mit nur „audio/*“ blendet iOS/macOS manche Dateien aus (z. B. .m4a aus Sprachmemos).
// Videos sind erlaubt – die Node nimmt dann deren Tonspur.
const AUDIO_ACCEPT = "audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.mp4,.mov";
const VIDEO_ACCEPT = "video/*,.mp4,.mov,.webm,.mkv";

const VIDEO_MODES: { value: VideoMode; label: string }[] = [
  { value: "video", label: "Bild" },
  { value: "audio", label: "nur Ton" },
  { value: "video_audio", label: "Bild + Ton" },
];

function inputFile(filename: string) {
  const i = filename.lastIndexOf("/");
  return { filename: i >= 0 ? filename.slice(i + 1) : filename, subfolder: i >= 0 ? filename.slice(0, i) : "", type: "input" };
}

async function upload(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Upload fehlgeschlagen");
  return data.filename as string;
}

/** Bildlimit je Modus (siehe MiniMaxH3Director: FL2VA nutzt slot 0/1, I2VA/L2VA nur ein Bild). */
export function imageLimit(mode: string) {
  if (mode === "REF2VA") return H3_MAX_IMAGES;
  if (mode === "FL2VA") return 2;
  if (mode === "I2VA" || mode === "L2VA" || mode === "Image Inpaint") return 1;
  return 0;
}

function imageLabel(mode: string, index: number) {
  if (mode === "FL2VA") return index === 0 ? "Erstes Bild" : "Letztes Bild";
  if (mode === "I2VA") return "Startbild";
  if (mode === "L2VA") return "Schlussbild";
  return `<Picture ${index + 1}>`;
}

export function RefEditor({ mode, refs, onChange }: { mode: string; refs: H3Ref[]; onChange: (r: H3Ref[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const images = refs.filter((r) => r.kind === "image");
  const audios = refs.filter((r) => r.kind === "audio");
  const videos = refs.filter((r) => r.kind === "video");
  const maxImages = imageLimit(mode);
  const audioAllowed = mode === "REF2VA";
  // Tonspuren: Audio-Dateien + Videos mit Ton teilen sich das Limit
  const soundSlots = H3_MAX_AUDIO - refs.filter(refHasSound).length;

  const add = async (files: FileList | null, kind: H3Ref["kind"]) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const free = kind === "image" ? maxImages - images.length : kind === "video" ? H3_MAX_VIDEOS - videos.length : soundSlots;
    const added: H3Ref[] = [];
    try {
      for (const f of Array.from(files).slice(0, Math.max(0, free)))
        added.push({ kind, filename: await upload(f), ...(kind === "video" ? { mediaMode: "video" as const } : {}) });
    } catch (err) {
      setError((err as Error).message);
    }
    onChange([...refs, ...added]);
    setBusy(false);
  };

  const remove = (r: H3Ref) => onChange(refs.filter((x) => x !== r));
  // Reihenfolge innerhalb einer Art tauschen (sie bestimmt die Nummer im Prompt-Tag)
  const move = (r: H3Ref, dir: -1 | 1) => {
    const same = refs.filter((x) => x.kind === r.kind);
    const other = same[same.indexOf(r) + dir];
    if (!other) return;
    onChange(refs.map((x) => (x === r ? other : x === other ? r : x)));
  };
  const patch = (r: H3Ref, p: Partial<H3Ref>) => onChange(refs.map((x) => (x === r ? { ...x, ...p } : x)));

  return (
    <div className="space-y-4">
      {maxImages === 0 ? (
        <p className="text-sm text-muted">Modus {mode} nutzt keine Referenzbilder.</p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {images.map((r, i) => (
              <div key={r.filename + i} className={`relative overflow-hidden rounded-xl border bg-bg ${i < maxImages ? "border-line" : "border-red-500/60 opacity-50"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={viewUrl(inputFile(r.filename), { preview: "webp;70" })} alt="" className="aspect-square w-full object-cover" />
                <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px]">{imageLabel(mode, i)}</span>
                <div className="flex justify-between bg-black/60 text-sm">
                  <button type="button" className="px-2 py-1.5" onClick={() => move(r, -1)} aria-label="nach vorne">
                    ◀
                  </button>
                  <button type="button" className="px-2 py-1.5" onClick={() => remove(r)} aria-label="entfernen">
                    ✕
                  </button>
                  <button type="button" className="px-2 py-1.5" onClick={() => move(r, 1)} aria-label="nach hinten">
                    ▶
                  </button>
                </div>
              </div>
            ))}
            {images.length < maxImages && (
              <button type="button" className="flex aspect-square flex-col items-center justify-center rounded-xl border border-dashed border-line text-muted" disabled={busy} onClick={() => imgInput.current?.click()}>
                <span className="text-2xl">＋</span>
                <span className="text-xs">
                  Bild ({images.length}/{maxImages})
                </span>
              </button>
            )}
          </div>
          <input ref={imgInput} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files, "image").then(() => (e.target.value = ""))} />
          {mode === "REF2VA" && <p className="text-xs text-muted">Im Prompt (subject_definitions) mit dem Tag ansprechen, z. B. „Subject 1 is the woman in &lt;Picture 1&gt;“. Reihenfolge = Nummer.</p>}
        </div>
      )}

      {audioAllowed && (
        <div className="space-y-2">
          {videos.map((r) => (
            <div key={r.filename} className="space-y-2 rounded-xl border border-line bg-bg p-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">{refTag(refs, r)}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{r.filename}</span>
                <button type="button" className="btn btn-ghost px-3" onClick={() => move(r, -1)} aria-label="nach oben">
                  ▲
                </button>
                <button type="button" className="btn btn-ghost px-3" onClick={() => remove(r)} aria-label="entfernen">
                  ✕
                </button>
              </div>
              <video
                src={viewUrl(inputFile(r.filename))}
                controls
                playsInline
                preload="metadata"
                className="max-h-56 w-full rounded-lg bg-black"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (Number.isFinite(d) && Math.abs(d - (r.duration ?? -1)) > 0.05) patch(r, { duration: d });
                }}
              />
              <div className="flex gap-1.5">
                {VIDEO_MODES.map((m) => {
                  // „Ton“-Modi nur, wenn noch eine Tonspur frei ist (oder dieses Video schon Ton nutzt)
                  const blocked = m.value !== "video" && !refHasSound(r) && soundSlots <= 0;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      disabled={blocked}
                      onClick={() => patch(r, { mediaMode: m.value })}
                      className={`min-h-9 flex-1 rounded-lg border text-sm disabled:opacity-40 ${videoMode(r) === m.value ? "border-accent bg-accent text-white" : "border-line text-soft"}`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted">
                {r.duration !== undefined ? `Länge ${r.duration.toFixed(1)} s · genutzt ${usedSeconds(r)?.toFixed(1)} s` : "Länge wird ermittelt …"}
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted">
                <label className="space-y-1">
                  Start (s)
                  <NumberInput value={r.trimStart ?? null} min={0} step={0.1} placeholder="0" onChange={(v) => patch(r, { trimStart: v ?? undefined })} />
                </label>
                <label className="space-y-1">
                  Ende (s)
                  <NumberInput value={r.trimEnd ?? null} min={0} step={0.1} placeholder="Ende" onChange={(v) => patch(r, { trimEnd: v ?? undefined })} />
                </label>
              </div>
            </div>
          ))}
          {videos.length < H3_MAX_VIDEOS && (
            <button type="button" className="btn btn-ghost w-full" disabled={busy} onClick={() => videoInput.current?.click()}>
              + Video-Referenz ({videos.length}/{H3_MAX_VIDEOS})
            </button>
          )}
          <input ref={videoInput} type="file" accept={VIDEO_ACCEPT} multiple hidden onChange={(e) => add(e.target.files, "video").then(() => (e.target.value = ""))} />
          <p className="text-xs text-muted">
            Video als Vorlage für Bewegung, Szene oder Person – im Prompt mit dem Tag ansprechen, z. B. „moves like in &lt;Video 1&gt;“. „nur Ton“ macht daraus eine
            &lt;Audio&gt;-Referenz. Alle Videos zusammen max. 15 s – mit Start/Ende kürzen.
          </p>
          {audios.map((r, i) => (
            <div key={r.filename + i} className="space-y-2 rounded-xl border border-line bg-bg p-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">{refTag(refs, r)}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{r.filename}</span>
                <button type="button" className="btn btn-ghost px-3" onClick={() => move(r, -1)} aria-label="nach oben">
                  ▲
                </button>
                <button type="button" className="btn btn-ghost px-3" onClick={() => remove(r)} aria-label="entfernen">
                  ✕
                </button>
              </div>
              <audio
                src={viewUrl(inputFile(r.filename))}
                controls
                className="w-full"
                preload="metadata"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (Number.isFinite(d) && Math.abs(d - (r.duration ?? -1)) > 0.05) patch(r, { duration: d });
                }}
              />
              <p className="text-xs text-muted">
                {r.duration !== undefined
                  ? `Länge ${r.duration.toFixed(1)} s · genutzt ${usedSeconds(r)?.toFixed(1)} s`
                  : "Länge wird ermittelt … (bei Videos evtl. unbekannt)"}
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted">
                <label className="space-y-1">
                  Start (s)
                  <NumberInput value={r.trimStart ?? null} min={0} step={0.1} placeholder="0" onChange={(v) => patch(r, { trimStart: v ?? undefined })} />
                </label>
                <label className="space-y-1">
                  Ende (s)
                  <NumberInput value={r.trimEnd ?? null} min={0} step={0.1} placeholder="Ende" onChange={(v) => patch(r, { trimEnd: v ?? undefined })} />
                </label>
              </div>
            </div>
          ))}
          {soundSlots > 0 && (
            <button type="button" className="btn btn-ghost w-full" disabled={busy} onClick={() => audioInput.current?.click()}>
              + Audio-Referenz ({H3_MAX_AUDIO - soundSlots}/{H3_MAX_AUDIO} Tonspuren)
            </button>
          )}
          <input ref={audioInput} type="file" accept={AUDIO_ACCEPT} multiple hidden onChange={(e) => add(e.target.files, "audio").then(() => (e.target.value = ""))} />
          <p className="text-xs text-muted">
            MP3, WAV, M4A, FLAC, OGG – oder ein Video (dann zählt nur der Ton). Jede Datei 2–15 s, aller Ton zusammen max. 15 s, mindestens ein Bild oder Video (Bild) nötig.
            Speaker-Zuordnung: &lt;Audio 1&gt; im Prompt der Stimme von (S1) zuordnen.
          </p>
          {refWarnings(refs).length > 0 && (
            <WarnBox>
              <ul className="space-y-1">
                {refWarnings(refs).map((w) => (
                  <li key={w}>⚠ {w}</li>
                ))}
              </ul>
            </WarnBox>
          )}
        </div>
      )}
      {busy && <p className="text-sm text-muted">Lade hoch … (bei Videos kann das etwas dauern)</p>}
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}
