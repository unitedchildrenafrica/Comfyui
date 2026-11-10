"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { redownload } from "@/lib/characterTools";
import { api } from "@/lib/client";
import { loraFits, type LoraUse } from "@/lib/loraKinds";
import { baseName, findAvailable } from "@/lib/notes";
import type { LoraEntry } from "@/lib/types";
import { Select, Slider, WarnBox } from "./ui";

/**
 * Aktive LoRAs, die es auf diesem Pod nicht gibt (z. B. auf einem früheren Pod geladen).
 * ComfyUI würde den Job sonst ablehnen. Mit gemerktem Link: direkt neu laden.
 */
function MissingLoras({ names, onReload }: { names: string[]; onReload?: () => void }) {
  const [links, setLinks] = useState<Record<string, string>>({});
  const [state, setState] = useState<Record<string, "busy" | "ok" | string>>({});
  useEffect(() => {
    api<{ links: { filename: string; url: string }[] }>("/api/model-links")
      .then((r) => setLinks(Object.fromEntries(r.links.map((l) => [l.filename.toLowerCase(), l.url]))))
      .catch(() => {});
  }, []);
  const linkFor = (n: string) => links[baseName(n).toLowerCase()];
  const load = async (n: string) => {
    setState((s) => ({ ...s, [n]: "busy" }));
    try {
      await redownload(n, linkFor(n), "lora");
      setState((s) => ({ ...s, [n]: "ok" }));
    } catch (err) {
      setState((s) => ({ ...s, [n]: (err as Error).message }));
    }
  };
  return (
    <WarnBox>
      <p className="font-medium">Auf diesem Pod fehlt{names.length > 1 ? "en" : ""} – der Job würde abgelehnt:</p>
      <ul className="mt-2 space-y-1.5">
        {names.map((n) => {
          const st = state[n];
          return (
            <li key={n} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 break-all">{n}</span>
              {st === "ok" ? (
                <span className="text-xs">lädt auf dem Pod …</span>
              ) : linkFor(n) ? (
                <button type="button" className="rounded-lg border border-amber-300/50 px-2 py-1 text-xs" disabled={st === "busy"} onClick={() => load(n)}>
                  {st === "busy" ? "…" : "⬇ Neu laden"}
                </button>
              ) : (
                <span className="text-xs opacity-80">kein Link gemerkt – über „Modelle laden“ holen oder Häkchen raus</span>
              )}
              {st && st !== "busy" && st !== "ok" && <span className="w-full text-xs text-red-200">{st}</span>}
            </li>
          );
        })}
      </ul>
      {Object.values(state).includes("ok") && onReload && (
        <button type="button" className="mt-2 text-xs underline" onClick={onReload}>
          ↻ Liste vom Pod neu laden (wenn der Download fertig ist)
        </button>
      )}
    </WarnBox>
  );
}

export function LoraList({
  loras,
  onChange,
  available,
  max,
  target,
  use = {},
  onReload,
}: {
  loras: LoraEntry[];
  onChange: (l: LoraEntry[]) => void;
  available: string[];
  max?: number;
  /** nur LoRAs für Bilder bzw. Videos zeigen (plus noch nicht zugeordnete) */
  target?: "image" | "video";
  use?: Record<string, { use: LoraUse | null }>;
  /** Auswahllisten vom Pod neu holen (nach einem Download) */
  onReload?: () => void;
}) {
  const update = (i: number, patch: Partial<LoraEntry>) => onChange(loras.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const canAdd = max === undefined || loras.length < max;
  const fitting = target ? available.filter((a) => loraFits(use[a]?.use, target)) : available;
  const unsorted = target ? available.filter((a) => !use[a]?.use).length : 0;
  const hidden = available.length - fitting.length;
  // Bereits gewählte LoRA bleibt wählbar, auch wenn sie zur anderen Liste gehört
  const optionsFor = (name: string) => (name && !fitting.includes(name) && available.includes(name) ? [name, ...fitting] : fitting);
  const missing = available.length ? loras.filter((l) => l.enabled && l.name && !findAvailable(l.name, available)).map((l) => l.name) : [];
  return (
    <div className="space-y-3">
      {missing.length > 0 && <MissingLoras names={missing} onReload={onReload} />}
      {loras.map((l, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-line bg-bg p-3">
          <div className="flex items-center gap-2">
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={l.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} aria-label="LoRA aktiv" />
            <div className="min-w-0 flex-1">
              <Select value={l.name} onChange={(v) => update(i, { name: v })} options={optionsFor(l.name)} />
            </div>
            <button type="button" className="btn btn-ghost px-3" aria-label="LoRA löschen" onClick={() => onChange(loras.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
          <Slider value={l.strength} min={0} max={2} step={0.05} onChange={(v) => update(i, { strength: v })} />
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost w-full"
        disabled={!canAdd || !fitting.length}
        onClick={() => onChange([...loras, { name: fitting[0] ?? "", strength: 1, enabled: true }])}
      >
        + LoRA hinzufügen{max ? ` (${loras.length}/${max})` : ""}
      </button>
      {target && (hidden > 0 || unsorted > 0) && (
        <p className="text-center text-xs text-muted">
          {hidden > 0 && `${hidden} ${target === "image" ? "Video" : "Bild"}-LoRAs ausgeblendet. `}
          {unsorted > 0 && `${unsorted} noch nicht zugeordnet (stehen in beiden Listen). `}
          <Link href="/modelle#loras" className="text-accent underline">
            Sortieren
          </Link>
        </p>
      )}
      <Link href="/modelle" className="block text-center text-xs text-accent underline">
        Neue LoRA per Link herunterladen
      </Link>
    </div>
  );
}
