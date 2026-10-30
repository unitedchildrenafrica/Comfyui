"use client";

import Link from "next/link";
import { loraFits, type LoraUse } from "@/lib/loraKinds";
import type { LoraEntry } from "@/lib/types";
import { Select, Slider } from "./ui";

export function LoraList({
  loras,
  onChange,
  available,
  max,
  target,
  use = {},
}: {
  loras: LoraEntry[];
  onChange: (l: LoraEntry[]) => void;
  available: string[];
  max?: number;
  /** nur LoRAs für Bilder bzw. Videos zeigen (plus noch nicht zugeordnete) */
  target?: "image" | "video";
  use?: Record<string, { use: LoraUse | null }>;
}) {
  const update = (i: number, patch: Partial<LoraEntry>) => onChange(loras.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const canAdd = max === undefined || loras.length < max;
  const fitting = target ? available.filter((a) => loraFits(use[a]?.use, target)) : available;
  const unsorted = target ? available.filter((a) => !use[a]?.use).length : 0;
  const hidden = available.length - fitting.length;
  // Bereits gewählte LoRA bleibt wählbar, auch wenn sie zur anderen Liste gehört
  const optionsFor = (name: string) => (name && !fitting.includes(name) && available.includes(name) ? [name, ...fitting] : fitting);
  return (
    <div className="space-y-3">
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
