"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLive } from "@/hooks/useLive";
import { alarmReady, releaseAlarm, startAlarm, stopAlarm, testAlarm, unlockAlarm } from "@/lib/alarm";
import { api } from "@/lib/client";

const KEY = "pf.bell";
const SEEN_KEY = "pf.bell.seen";
const EVENT = "pf-bell-change";

function readBell(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function writeSeen(s: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-200)));
  } catch {}
}

export function useBell() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(readBell());
    const h = () => setOn(readBell());
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);
  const toggle = useCallback(async () => {
    const next = !readBell();
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {}
    if (next) {
      // Neu eingeschaltet: alles bisher Fertige nicht nachträglich melden
      try {
        localStorage.removeItem(SEEN_KEY);
      } catch {}
      await unlockAlarm();
    } else releaseAlarm();
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { on, toggle };
}

/** 🔔-Knopf zum An-/Ausschalten (z. B. neben der Überschrift), mit „Test“ wenn an. */
export function BellToggle() {
  const { on, toggle } = useBell();
  return (
    <span className="inline-flex items-center gap-1.5">
      {on && (
        <button type="button" onClick={() => testAlarm()} className="min-h-10 rounded-xl border border-line bg-bg px-3 text-sm text-soft">
          🔊 Test
        </button>
      )}
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium ${on ? "border-amber-400/60 bg-amber-400/15 text-amber-200" : "border-line bg-bg text-muted"}`}
    >
      {on ? "🔔 Wecker an" : "🔕 Wecker aus"}
    </button>
    </span>
  );
}

type RecentItem = { promptId: string; kind: string | null; status: string; label: string };

/**
 * Läuft auf jeder Seite (im Layout). Ist die Glocke an, klingelt nach jedem fertigen Video ein
 * Dauer-Alarm, bis man auf den Bildschirm tippt. Erkennt fertige Jobs live (SSE) und zusätzlich
 * per Abfrage alle 10 s – falls das Handy kurz die Verbindung verloren hat.
 */
export function AlarmHost() {
  const path = usePathname();
  const { on } = useBell();
  const [ringing, setRinging] = useState<{ label: string; error: boolean } | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const active = on && !path.startsWith("/login");
  // Live gemeldete Abbrüche (Stopp/Abbrechen) – zusätzlich zum Verlauf, falls der es nicht vermerkt
  const interrupted = useRef(new Set<string>());

  const check = useCallback(async () => {
    if (!active) return;
    let recent: RecentItem[];
    try {
      recent = (await api<{ recent: RecentItem[] }>("/api/queue")).recent ?? [];
    } catch {
      return;
    }
    // Direkt nach dem Einschalten: alles schon Fertige gilt als gesehen. Danach bleibt die Liste
    // gespeichert – war das iPhone im Hintergrund, klingelt es beim Zurückkommen trotzdem.
    let hasBaseline = true;
    try {
      hasBaseline = localStorage.getItem(SEEN_KEY) !== null;
    } catch {}
    const seen = readSeen();
    if (!hasBaseline) {
      recent.forEach((r) => seen.add(r.promptId));
      writeSeen(seen);
      return;
    }
    const fresh = recent.filter((r) => !seen.has(r.promptId));
    fresh.forEach((r) => seen.add(r.promptId));
    if (fresh.length) writeSeen(seen);
    // Selbst gestoppte Videos („interrupted“) lösen nie einen Alarm aus
    const video = fresh.find((r) => r.kind === "video" && r.status !== "interrupted" && !interrupted.current.has(r.promptId));
    if (video) {
      setRinging({ label: video.label, error: video.status === "error" });
      startAlarm();
    }
  }, [active]);

  useLive((e) => {
    if (e.result === "interrupted") interrupted.current.add(e.promptId);
    // kurz warten, bis ComfyUI den Verlauf geschrieben hat
    setTimeout(check, 1500);
  }, active);

  // Nach dem Neuladen: der erste Tipp irgendwo auf der Seite gibt den Ton wieder frei
  useEffect(() => {
    if (!active) return;
    const onTap = () => {
      if (!alarmReady()) unlockAlarm();
    };
    document.addEventListener("pointerdown", onTap, true);
    return () => document.removeEventListener("pointerdown", onTap, true);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    check();
    const t = setInterval(check, 10_000);
    // zurück aus dem Hintergrund → sofort nachsehen
    const onVis = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active, check]);

  // Bildschirm wach halten, solange die Glocke an ist (sonst stoppt iOS Safari im Hintergrund)
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {}
    };
    request();
    const onVis = () => document.visibilityState === "visible" && request();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, [active]);

  // Nach dem Neuladen der Seite muss iOS den Ton einmal per Tipp freigeben
  useEffect(() => {
    if (!active) return setNeedsTap(false);
    const t = setInterval(() => setNeedsTap(!alarmReady()), 1000);
    return () => clearInterval(t);
  }, [active]);

  const dismiss = () => {
    stopAlarm();
    setRinging(null);
  };

  if (ringing) {
    return (
      <button
        type="button"
        onClick={dismiss}
        className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-red-600 px-6 text-center text-white"
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <span className="animate-bounce text-7xl">⏰</span>
        <span className="text-3xl font-bold">{ringing.error ? "Video fehlgeschlagen!" : "Video fertig!"}</span>
        <span className="max-w-sm truncate text-lg opacity-90">{ringing.label}</span>
        <span className="mt-6 rounded-2xl bg-white/20 px-6 py-4 text-xl font-semibold">Tippen zum Stoppen</span>
      </button>
    );
  }

  if (active && needsTap) {
    return (
      <button
        type="button"
        onClick={() => unlockAlarm().then(() => setNeedsTap(!alarmReady()))}
        className="fixed inset-x-3 top-3 z-[90] rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-black shadow-lg"
        style={{ marginTop: "env(safe-area-inset-top)" }}
      >
        🔔 Einmal tippen, damit der Wecker klingeln darf
      </button>
    );
  }
  return null;
}
