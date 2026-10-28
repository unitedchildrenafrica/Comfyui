"use client";

import { type ReactNode, useId, useState } from "react";

export function Section({ title, children, defaultOpen = false, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="card">
      <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="font-semibold">{title}</span>
        <span className="flex items-center gap-2 text-sm text-muted">
          {right}
          <span className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
            ▾
          </span>
        </span>
      </button>
      {open && <div className="space-y-4 border-t border-line px-4 py-4">{children}</div>}
    </section>
  );
}

export function Field({ label, hint, children, right }: { label: string; hint?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium text-soft">{label}</label>
        {right && <span className="text-sm text-muted">{right}</span>}
      </div>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: (string | { value: string; label: string })[];
  disabled?: boolean;
  placeholder?: string;
}) {
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const missing = value && !opts.some((o) => o.value === value);
  return (
    <select className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="">{placeholder ?? "– auswählen –"}</option>}
      {missing && <option value={value}>{value} (nicht auf dem Pod)</option>}
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" className="range flex-1" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input
        type="number"
        inputMode="decimal"
        className="input w-20 text-center"
        min={min}
        max={max}
        step={step}
        value={format ? format(value) : value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </div>
  );
}

export function NumberInput({ value, onChange, min, max, step = 1, placeholder }: { value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; step?: number; placeholder?: string }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      className="input"
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => {
        if (e.target.value === "") return onChange(null);
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
    />
  );
}

export function Toggle({ checked, onChange, label, disabled, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className={disabled ? "opacity-50" : ""}>
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
        <span className="text-sm font-medium text-soft">{label}</span>
        <span className="relative inline-flex">
          <input id={id} type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
          <span className="h-7 w-12 rounded-full bg-line transition peer-checked:bg-accent" />
          <span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-5" />
        </span>
      </label>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-xl bg-bg p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={`min-h-10 flex-1 rounded-lg px-3 text-sm font-medium transition ${value === o.value ? "bg-accent text-white" : "text-soft hover:bg-card"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{children}</div>;
}

export function WarnBox({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{children}</div>;
}

export function ComfyDown({ onRetry, message = "ComfyUI antwortet nicht" }: { onRetry: () => void; message?: string }) {
  return (
    <div className="card space-y-3 p-4 text-center">
      <p className="font-semibold">{message}</p>
      <p className="text-sm text-muted">Läuft der Pod noch hoch oder ist ComfyUI abgestürzt?</p>
      <button type="button" className="btn btn-primary w-full" onClick={onRetry}>
        Erneut versuchen
      </button>
    </div>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-line">
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Lesbare Ausgabe von node_errors aus /prompt. */
export function NodeErrors({ errors }: { errors: Record<string, unknown> }) {
  const entries = Object.entries(errors ?? {});
  if (!entries.length) return null;
  return (
    <ul className="mt-2 space-y-1.5 text-xs">
      {entries.map(([id, raw]) => {
        const e = raw as { class_type?: string; errors?: { message?: string; details?: string; extra_info?: { input_name?: string; received_value?: unknown } }[] };
        return (
          <li key={id}>
            <span className="font-semibold">
              Node {id} {e.class_type ? `(${e.class_type})` : ""}:
            </span>{" "}
            {(e.errors ?? []).map((x, i) => (
              <span key={i} className="block">
                {x.message}
                {x.extra_info?.input_name ? ` – ${x.extra_info.input_name}` : ""}
                {x.extra_info?.received_value !== undefined ? ` = ${JSON.stringify(x.extra_info.received_value)}` : ""}
                {x.details && !x.extra_info ? ` – ${x.details}` : ""}
              </span>
            ))}
          </li>
        );
      })}
    </ul>
  );
}
