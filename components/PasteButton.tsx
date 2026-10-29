"use client";

import { useState } from "react";

/**
 * Fügt die Zwischenablage ein und ersetzt den bisherigen Text.
 * iOS fragt dabei einmal mit einer kleinen „Einfügen“-Blase nach – das ist normal.
 */
export function PasteButton({
  onPaste,
  label = "📋 Einfügen",
  block = false,
}: {
  onPaste: (text: string) => void;
  label?: string;
  /** breiter Knopf über die ganze Zeile */
  block?: boolean;
}) {
  const [msg, setMsg] = useState<string | null>(null);

  const paste = async () => {
    setMsg(null);
    try {
      if (!navigator.clipboard?.readText) throw new Error("unsupported");
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setMsg("Zwischenablage ist leer");
        return;
      }
      onPaste(text.trim());
      setMsg("✓ eingefügt");
      setTimeout(() => setMsg(null), 1500);
    } catch {
      setMsg("Kein Zugriff – ins Feld tippen und „Einfügen“ wählen");
    }
  };

  if (block) {
    return (
      <button type="button" onClick={paste} className="btn btn-ghost w-full">
        {msg ?? label}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {msg && <span className="text-xs text-muted">{msg}</span>}
      <button type="button" onClick={paste} className="rounded-lg border border-line bg-bg px-2.5 py-1 text-xs font-medium text-soft active:scale-95">
        {label}
      </button>
    </span>
  );
}
