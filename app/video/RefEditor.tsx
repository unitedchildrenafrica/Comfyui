"use client";

import { useRef, useState } from "react";
import { viewUrl } from "@/lib/client";
import { H3_MAX_AUDIO, H3_MAX_IMAGES } from "@/lib/builders/h3";
import type { H3Ref } from "@/lib/types";
import { ErrorBox, NumberInput } from "@/components/ui";

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
  const images = refs.filter((r) => r.kind === "image");
  const audios = refs.filter((r) => r.kind === "audio");
  const maxImages = imageLimit(mode);
  const audioAllowed = mode === "REF2VA";

  const add = async (files: FileList | null, kind: H3Ref["kind"]) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const free = kind === "image" ? maxImages - images.length : H3_MAX_AUDIO - audios.length;
    const added: H3Ref[] = [];
    try {
      for (const f of Array.from(files).slice(0, Math.max(0, free))) added.push({ kind, filename: await upload(f) });
    } catch (err) {
      setError((err as Error).message);
    }
    onChange([...refs, ...added]);
    setBusy(false);
  };

  const remove = (r: H3Ref) => onChange(refs.filter((x) => x !== r));
  const move = (r: H3Ref, dir: -1 | 1) => {
    const same = refs.filter((x) => x.kind === r.kind);
    const i = same.indexOf(r);
    const j = i + dir;
    if (j < 0 || j >= same.length) return;
    [same[i], same[j]] = [same[j], same[i]];
    const other = refs.filter((x) => x.kind !== r.kind);
    onChange(r.kind === "image" ? [...same, ...other] : [...other, ...same]);
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
          {audios.map((r, i) => (
            <div key={r.filename + i} className="space-y-2 rounded-xl border border-line bg-bg p-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">&lt;Audio {i + 1}&gt;</span>
                <span className="min-w-0 flex-1 truncate text-muted">{r.filename}</span>
                <button type="button" className="btn btn-ghost px-3" onClick={() => move(r, -1)} aria-label="nach oben">
                  ▲
                </button>
                <button type="button" className="btn btn-ghost px-3" onClick={() => remove(r)} aria-label="entfernen">
                  ✕
                </button>
              </div>
              <audio src={viewUrl(inputFile(r.filename))} controls className="w-full" preload="metadata" />
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
          {audios.length < H3_MAX_AUDIO && (
            <button type="button" className="btn btn-ghost w-full" disabled={busy} onClick={() => audioInput.current?.click()}>
              + Audio-Referenz ({audios.length}/{H3_MAX_AUDIO})
            </button>
          )}
          <input ref={audioInput} type="file" accept="audio/*" multiple hidden onChange={(e) => add(e.target.files, "audio").then(() => (e.target.value = ""))} />
          <p className="text-xs text-muted">Speaker-Zuordnung: &lt;Audio 1&gt; im Prompt der Stimme von (S1) zuordnen. Audio braucht mindestens ein Bild, max. 15 s gesamt.</p>
        </div>
      )}
      {busy && <p className="text-sm text-muted">Lade hoch …</p>}
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}
