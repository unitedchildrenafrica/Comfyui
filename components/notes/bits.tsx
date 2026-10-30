"use client";

import { type ReactNode, useState } from "react";
import { copyText } from "./useNotes";

export function CopyButton({ text, label = "📋 Kopieren", className = "" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <button
      type="button"
      className={`btn btn-ghost min-h-9 px-3 text-sm ${className}`}
      onClick={async () => {
        setState((await copyText(text)) ? "ok" : "fail");
        setTimeout(() => setState("idle"), 1500);
      }}
    >
      {state === "ok" ? "✓ Kopiert" : state === "fail" ? "Ging nicht" : label}
    </button>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "green" | "amber" | "red" }) {
  const tones = {
    muted: "border-line text-muted",
    accent: "border-accent/50 text-accent",
    green: "border-emerald-500/40 text-emerald-300",
    amber: "border-amber-500/50 text-amber-200",
    red: "border-red-500/50 text-red-300",
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${tones[tone]}`}>{children}</span>;
}

/** Kleine Auswahl-Knöpfe in einer Reihe (Status u. ä.) */
export function Chips<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`min-h-8 rounded-full border px-3 text-xs font-medium transition ${value === o.value ? "border-accent bg-accent text-white" : "border-line text-soft"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function KindToggle({ value, onChange }: { value: "image" | "video"; onChange: (v: "image" | "video") => void }) {
  return (
    <Chips
      value={value}
      onChange={onChange}
      options={[
        { value: "image", label: "🖼️ Bild" },
        { value: "video", label: "🎬 Video" },
      ]}
    />
  );
}

export const kindLabel = (k: "image" | "video") => (k === "video" ? "🎬 Video" : "🖼️ Bild");

/** ✎ ▲ ▼ am Rand einer Karte */
export function RowActions({ onEdit, onUp, onDown }: { onEdit?: () => void; onUp?: () => void; onDown?: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {onUp && (
        <button type="button" className="h-9 w-8 rounded-lg text-muted hover:bg-bg" aria-label="nach oben" onClick={onUp}>
          ▲
        </button>
      )}
      {onDown && (
        <button type="button" className="h-9 w-8 rounded-lg text-muted hover:bg-bg" aria-label="nach unten" onClick={onDown}>
          ▼
        </button>
      )}
      {onEdit && (
        <button type="button" className="h-9 w-9 rounded-lg text-soft hover:bg-bg" aria-label="bearbeiten" onClick={onEdit}>
          ✎
        </button>
      )}
    </div>
  );
}

/** Rahmen für ein Bearbeiten-Formular mit Speichern / Abbrechen / Löschen */
export function EditorFrame({
  children,
  onSave,
  onCancel,
  onDelete,
  canSave = true,
  error,
}: {
  children: ReactNode;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  canSave?: boolean;
  error?: string | null;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-accent/60 bg-bg p-3">
      {children}
      {error && <p className="text-sm text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary flex-1" disabled={!canSave} onClick={onSave}>
          Speichern
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Abbrechen
        </button>
        {onDelete && (
          <button
            type="button"
            className="btn btn-danger px-3"
            aria-label="löschen"
            onClick={() => {
              if (window.confirm("Wirklich löschen?")) onDelete();
            }}
          >
            🗑
          </button>
        )}
      </div>
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="mb-1 block text-xs font-medium text-muted">{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

/** Mehrzeiliger Text, gekürzt mit „mehr“ */
export function Clamp({ text, lines = 3, mono = false }: { text: string; lines?: number; mono?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  const long = text.split("\n").length > lines || text.length > lines * 90;
  return (
    <div className="min-w-0">
      <p
        className={`whitespace-pre-wrap break-words text-sm text-soft ${mono ? "font-mono text-[13px]" : ""}`}
        style={!open && long ? { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" } : undefined}
      >
        {text}
      </p>
      {long && (
        <button type="button" className="text-xs text-accent" onClick={() => setOpen(!open)}>
          {open ? "weniger" : "mehr"}
        </button>
      )}
    </div>
  );
}
export function ProgressLine({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-line">
      <div className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-emerald-500" : "bg-accent"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
