"use client";

import Link from "next/link";
import type { LoraEntry } from "@/lib/types";
import { Select, Slider } from "./ui";

export function LoraList({ loras, onChange, available, max }: { loras: LoraEntry[]; onChange: (l: LoraEntry[]) => void; available: string[]; max?: number }) {
  const update = (i: number, patch: Partial<LoraEntry>) => onChange(loras.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const canAdd = max === undefined || loras.length < max;
  return (
    <div className="space-y-3">
      {loras.map((l, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-line bg-bg p-3">
          <div className="flex items-center gap-2">
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={l.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} aria-label="LoRA aktiv" />
            <div className="min-w-0 flex-1">
              <Select value={l.name} onChange={(v) => update(i, { name: v })} options={available} />
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
        disabled={!canAdd || !available.length}
        onClick={() => onChange([...loras, { name: available[0] ?? "", strength: 1, enabled: true }])}
      >
        + LoRA hinzufügen{max ? ` (${loras.length}/${max})` : ""}
      </button>
      <Link href="/modelle" className="block text-center text-xs text-accent underline">
        Neue LoRA per Link herunterladen
      </Link>
    </div>
  );
}
