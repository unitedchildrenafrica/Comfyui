"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useOptions } from "@/hooks/useOptions";
import { redownload, sendCharacterToImageForm } from "@/lib/characterTools";
import { api, IMAGE_FORM_KEY, loadLocal } from "@/lib/client";
import { loraFits } from "@/lib/loraKinds";
import { baseName, type Character, type CharacterLora, findAvailable, matches, newId } from "@/lib/notes";
import type { ImageGenerator, ImageSettings } from "@/lib/types";
import { Badge, Chips, Clamp, CopyButton, EditorFrame, Empty, Label, RowActions } from "./bits";
import type { NotesApi } from "./useNotes";

interface ModelLink {
  filename: string;
  url: string;
  type: string;
}

const GENS: { value: ImageGenerator; label: string }[] = [
  { value: "wai", label: "WAI" },
  { value: "pony", label: "Pony" },
  { value: "anima", label: "Anima" },
];

const blank = (): Character => ({
  id: newId(),
  createdAt: Date.now(),
  updatedAt: 0,
  name: "",
  series: "",
  generator: "wai",
  checkpoint: "",
  positive: "",
  negative: "",
  loras: [],
  note: "",
});

function useModelLinks() {
  const [links, setLinks] = useState<ModelLink[]>([]);
  const load = useCallback(() => {
    api<{ links: ModelLink[] }>("/api/model-links").then((r) => setLinks(r.links), () => {});
  }, []);
  useEffect(load, [load]);
  const find = (name: string) => links.find((l) => l.filename.toLowerCase() === baseName(name).toLowerCase()) ?? null;
  return { links, find, reload: load };
}

function CharacterEditor({ initial, notes, loras, checkpoints, onDone }: { initial: Character; notes: NotesApi; loras: string[]; checkpoints: string[]; onDone: () => void }) {
  const [c, setC] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (x: Partial<Character>) => setC((v) => ({ ...v, ...x }));
  const setLora = (i: number, x: Partial<CharacterLora>) => set({ loras: c.loras.map((l, j) => (j === i ? { ...l, ...x } : l)) });
  const isNew = !initial.updatedAt;
  const id = initial.id;

  const fromForm = () => {
    const stored = loadLocal<{ generator?: ImageGenerator; all?: Partial<Record<ImageGenerator, ImageSettings>> }>(IMAGE_FORM_KEY, {});
    const g = stored.generator ?? "wai";
    const s = stored.all?.[g];
    if (!s) return setError("Im Bild-Formular ist noch nichts gespeichert.");
    set({
      generator: g,
      checkpoint: g === "anima" ? "" : s.checkpoint ?? "",
      positive: s.positive ?? "",
      negative: s.negative ?? "",
      loras: (s.loras ?? []).filter((l) => l.enabled && l.name).map((l) => ({ name: l.name, strength: l.strength })),
    });
    setError(null);
  };

  return (
    <EditorFrame
      canSave={!!c.name.trim()}
      error={error}
      onCancel={onDone}
      onDelete={isNew ? undefined : () => (notes.remove("characters", c.id), onDone())}
      onSave={async () => {
        const res = await notes.save("characters", { ...c, name: c.name.trim(), loras: c.loras.filter((l) => l.name.trim()) });
        if (res.ok) onDone();
        else setError(res.message);
      }}
    >
      <button type="button" className="btn btn-ghost min-h-9 w-full text-sm" onClick={fromForm}>
        ⤵ Prompt, LoRAs und Modell aus dem Bild-Formular holen
      </button>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <Label>Charakter</Label>
          <input className="input" value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="z. B. Ahri" autoFocus={isNew} />
        </label>
        <label className="block">
          <Label>Serie / Spiel</Label>
          <input className="input" value={c.series} onChange={(e) => set({ series: e.target.value })} placeholder="z. B. League of Legends" />
        </label>
      </div>
      <div>
        <Label>Generator</Label>
        <Chips value={c.generator} onChange={(generator) => set({ generator })} options={GENS} />
      </div>
      {c.generator !== "anima" && (
        <label className="block">
          <Label>Checkpoint (leer = im Formular nicht ändern)</Label>
          <input className="input text-sm" list={`ckpt-${id}`} value={c.checkpoint} onChange={(e) => set({ checkpoint: e.target.value })} />
          <datalist id={`ckpt-${id}`}>
            {checkpoints.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </label>
      )}
      <label className="block">
        <Label>Positiver Prompt</Label>
        <textarea className="input min-h-24 text-sm" value={c.positive} onChange={(e) => set({ positive: e.target.value })} placeholder="ahri, league of legends, fox ears, …" />
      </label>
      <label className="block">
        <Label>Negativer Prompt (leer = Standard)</Label>
        <textarea className="input min-h-14 text-sm" value={c.negative} onChange={(e) => set({ negative: e.target.value })} />
      </label>
      <div className="space-y-2">
        <Label>LoRAs</Label>
        <datalist id={`loras-${id}`}>
          {loras.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
        {c.loras.map((l, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-line p-2">
            <div className="flex gap-2">
              <input className="input flex-1 text-sm" list={`loras-${id}`} value={l.name} placeholder="Dateiname.safetensors" onChange={(e) => setLora(i, { name: e.target.value })} />
              <input
                type="number"
                inputMode="decimal"
                step={0.05}
                min={-2}
                max={2}
                className="input w-20 text-center"
                value={l.strength}
                onChange={(e) => Number.isFinite(Number(e.target.value)) && setLora(i, { strength: Number(e.target.value) })}
                aria-label="Stärke"
              />
              <button type="button" className="btn btn-ghost px-3" aria-label="LoRA entfernen" onClick={() => set({ loras: c.loras.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
            <input
              className="input text-xs"
              value={l.url ?? ""}
              placeholder="Download-Link (wird automatisch gemerkt, wenn über „Modelle laden“ geladen)"
              onChange={(e) => setLora(i, { url: e.target.value.trim() || undefined })}
            />
          </div>
        ))}
        <button type="button" className="btn btn-ghost min-h-9 w-full text-sm" onClick={() => set({ loras: [...c.loras, { name: "", strength: 1 }] })}>
          + LoRA
        </button>
      </div>
      <label className="block">
        <Label>Notiz</Label>
        <textarea className="input min-h-14 text-sm" value={c.note} onChange={(e) => set({ note: e.target.value })} placeholder="Outfits, gute Seeds, was gut funktioniert …" />
      </label>
    </EditorFrame>
  );
}

type DlState = Record<string, { busy?: boolean; ok?: boolean; error?: string }>;

export function CharactersTab({ notes, query }: { notes: NotesApi; query: string }) {
  const router = useRouter();
  const path = usePathname();
  const { options, error: optError, reload: reloadOptions } = useOptions();
  const links = useModelLinks();
  const [editing, setEditing] = useState<Character | null>(null);
  const [dl, setDl] = useState<DlState>({});
  const [applied, setApplied] = useState<string | null>(null);
  const list = notes.data.characters
    .filter((c) => matches("characters", c, query))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
  const available = options?.loras ?? null;
  const imageLoras = (options?.loras ?? []).filter((l) => loraFits(options?.loraUse?.[l]?.use, "image"));

  const linkFor = (l: CharacterLora) => l.url || links.find(l.name)?.url || null;

  const load = async (l: CharacterLora) => {
    const url = linkFor(l);
    if (!url) return;
    setDl((d) => ({ ...d, [l.name]: { busy: true } }));
    try {
      await redownload(l.name, url, "lora");
      setDl((d) => ({ ...d, [l.name]: { ok: true } }));
      links.reload();
    } catch (err) {
      setDl((d) => ({ ...d, [l.name]: { error: (err as Error).message } }));
    }
  };

  const apply = (c: Character) => {
    sendCharacterToImageForm(c);
    setApplied(c.id);
    setTimeout(() => setApplied(null), 2000);
    if (!path.startsWith("/bild")) router.push("/bild");
  };

  return (
    <div className="space-y-3">
      {editing && !editing.updatedAt ? (
        <CharacterEditor initial={editing} notes={notes} loras={imageLoras} checkpoints={options?.checkpoints ?? []} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="btn btn-primary w-full" onClick={() => setEditing(blank())}>
          + Charakter
        </button>
      )}
      {optError && (
        <p className="px-1 text-xs text-muted">
          Pod nicht erreichbar – ob die LoRAs da sind, ist gerade unbekannt.{" "}
          <button type="button" className="text-accent underline" onClick={reloadOptions}>
            nochmal prüfen
          </button>
        </p>
      )}
      {!list.length && <Empty>{query ? "Nichts gefunden." : "Speichere Charaktere mit Prompt, LoRAs und Modell – ein Tipp setzt alles ins Bild-Formular."}</Empty>}
      {list.map((c) => {
        if (editing?.id === c.id)
          return <CharacterEditor key={c.id} initial={editing} notes={notes} loras={imageLoras} checkpoints={options?.checkpoints ?? []} onDone={() => setEditing(null)} />;
        const missing = available ? c.loras.filter((l) => !findAvailable(l.name, available)) : [];
        const loadable = missing.filter((l) => linkFor(l) && !dl[l.name]?.ok);
        return (
          <div key={c.id} className="space-y-2 rounded-xl border border-line bg-bg p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-snug">{c.name}</p>
                {c.series && <p className="text-sm text-soft">{c.series}</p>}
              </div>
              <RowActions onEdit={() => setEditing(c)} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="accent">{GENS.find((g) => g.value === c.generator)?.label}</Badge>
              {c.checkpoint && c.generator !== "anima" && (
                <Badge tone={available && options && !options.checkpoints.includes(c.checkpoint) ? "red" : "muted"}>{c.checkpoint.replace(/\.safetensors$/, "")}</Badge>
              )}
            </div>
            <Clamp text={c.positive} lines={2} mono />
            {c.loras.length > 0 && (
              <ul className="space-y-1">
                {c.loras.map((l) => {
                  const here = available ? !!findAvailable(l.name, available) : null;
                  const st = dl[l.name];
                  return (
                    <li key={l.name} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className={here === false ? "text-red-300" : here ? "text-emerald-300" : "text-muted"}>{here === false ? "✗" : here ? "✓" : "•"}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {baseName(l.name).replace(/\.safetensors$/, "")} <span className="text-muted">({l.strength})</span>
                      </span>
                      {here === false &&
                        (st?.ok ? (
                          <span className="text-xs text-emerald-300">lädt auf dem Pod …</span>
                        ) : linkFor(l) ? (
                          <button type="button" className="h-8 rounded-lg border border-line px-2 text-xs text-soft" disabled={st?.busy} onClick={() => load(l)}>
                            {st?.busy ? "…" : "⬇ laden"}
                          </button>
                        ) : (
                          <span className="text-xs text-muted">kein Link – ✎ eintragen</span>
                        ))}
                      {st?.error && <span className="w-full text-xs text-red-300">{st.error}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            {loadable.length > 1 && (
              <button type="button" className="btn btn-ghost min-h-9 w-full text-sm" onClick={() => loadable.forEach(load)}>
                ⬇ Alle fehlenden laden ({loadable.length})
              </button>
            )}
            {Object.values(dl).some((x) => x.ok) && (
              <button type="button" className="text-xs text-accent underline" onClick={reloadOptions}>
                ↻ Liste vom Pod neu laden (wenn der Download fertig ist)
              </button>
            )}
            <Clamp text={c.note} lines={2} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary min-h-9 flex-1 text-sm" onClick={() => apply(c)}>
                {applied === c.id ? "✓ übernommen" : "🖼️ Ins Bild-Formular"}
              </button>
              {c.positive.trim() && <CopyButton text={c.positive} label="📋 Prompt" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
