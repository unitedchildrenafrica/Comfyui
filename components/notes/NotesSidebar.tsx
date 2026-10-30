"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { loadLocal, saveLocal } from "@/lib/client";
import { NotesPanel } from "./NotesPanel";

const KEY = "pf.notes.sidebar";
const MIN = 300;
const DEFAULT = 420;

/**
 * Am PC/Mac (ab 1024 px Breite): Notizen fest links, die App rückt nach rechts.
 * Breite per Ziehen am Rand, ganz einklappbar. Am Handy gibt es dafür den Tab „Notizen“.
 */
export function NotesSidebar() {
  const path = usePathname();
  const [desktop, setDesktop] = useState(false);
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState(DEFAULT);
  const dragging = useRef(false);

  useEffect(() => {
    const s = loadLocal(KEY, { open: true, width: DEFAULT });
    setOpen(s.open);
    setWidth(s.width);
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const hidden = !desktop || path.startsWith("/login") || path.startsWith("/notizen");
  const shown = !hidden && open;
  const clamp = (w: number) => Math.round(Math.min(Math.max(w, MIN), window.innerWidth * 0.6));

  // Platz für die Leiste: body und feste Leisten rücken um --notes-w nach rechts
  useEffect(() => {
    document.documentElement.style.setProperty("--notes-w", shown ? `${width}px` : "0px");
  }, [shown, width]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragging.current) setWidth(clamp(e.clientX));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = "";
      setWidth((w) => (saveLocal(KEY, { open: true, width: w }), w));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const toggle = (next: boolean) => {
    setOpen(next);
    saveLocal(KEY, { open: next, width });
  };

  if (hidden) return null;
  if (!open)
    return (
      <button
        type="button"
        onClick={() => toggle(true)}
        className="fixed left-0 top-1/2 z-30 -translate-y-1/2 rounded-r-xl border border-l-0 border-line bg-card px-2 py-4 text-lg shadow-lg"
        aria-label="Notizen öffnen"
        title="Notizen öffnen"
      >
        📝
      </button>
    );

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex border-r border-line bg-card" style={{ width }}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">📝 Notizen</h2>
          <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => toggle(false)} aria-label="Notizen einklappen">
            ⟨ einklappen
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <NotesPanel compact />
        </div>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Breite ändern"
        className="w-1.5 shrink-0 cursor-col-resize bg-line/40 hover:bg-accent/60"
        onPointerDown={(e) => {
          e.preventDefault();
          dragging.current = true;
          document.body.style.userSelect = "none";
        }}
        onDoubleClick={() => (setWidth(DEFAULT), saveLocal(KEY, { open: true, width: DEFAULT }))}
      />
    </aside>
  );
}
