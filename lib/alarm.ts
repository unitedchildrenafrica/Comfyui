"use client";

// Lauter Dauer-Alarm über Web Audio (keine Audiodatei nötig).
// iOS: Ton geht erst, nachdem der Nutzer einmal getippt hat (unlockAlarm im Klick-Handler).

type AudioSessionNav = Navigator & { audioSession?: { type: string } };

let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Muss in einem Tipp/Klick aufgerufen werden. Spielt einen kurzen leisen Ton zum Freischalten. */
export async function unlockAlarm() {
  // Safari 17+: „playback“ spielt auch im Lautlos-Modus (wie ein Wecker)
  try {
    const nav = navigator as AudioSessionNav;
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {}
  const c = context();
  if (!c) return false;
  if (c.state !== "running") await c.resume().catch(() => {});
  beep(c, 0, 660, 0.05, 0.05);
  return c.state === "running";
}

export function alarmReady() {
  return ctx?.state === "running";
}

function beep(c: AudioContext, at: number, freq: number, dur: number, vol: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  const t = c.currentTime + at;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.01);
  gain.gain.setValueAtTime(vol, t + dur - 0.02);
  gain.gain.linearRampToValueAtTime(0, t + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Wecker-Muster (hoch-tief-hoch, Pause) in Dauerschleife, bis stopAlarm(). */
export function startAlarm() {
  const c = context();
  if (!c || timer) return;
  c.resume().catch(() => {});
  const pattern = () => {
    beep(c, 0, 1046, 0.18, 1);
    beep(c, 0.22, 784, 0.18, 1);
    beep(c, 0.44, 1046, 0.18, 1);
    beep(c, 0.66, 784, 0.18, 1);
  };
  pattern();
  timer = setInterval(pattern, 1200);
}

export function stopAlarm() {
  if (timer) clearInterval(timer);
  timer = null;
}
