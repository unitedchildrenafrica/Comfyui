"use client";

// Wecker-Ton über ein <audio>-Element mit echter WAV-Datei.
// Warum nicht Web Audio: iOS Safari hält Web Audio oft stumm (braucht frischen Tipp, folgt dem
// Lautlos-Schalter). Media-Elemente spielen dagegen auch im Lautlos-Modus – wenn sie einmal per
// Tipp freigegeben wurden. Deshalb gibt unlockAlarm() (im Klick-Handler!) beide Elemente frei:
//  - keepAlive: spielt eine Stille-Datei in Endlosschleife und hält die Audio-Sitzung offen
//  - alarm: wird kurz stumm gestartet und pausiert → darf später ohne Tipp losklingeln

type AudioSessionNav = Navigator & { audioSession?: { type: string } };

let keepAlive: HTMLAudioElement | null = null;
let alarm: HTMLAudioElement | null = null;
let unlocked = false;

function make(src: string) {
  const a = new Audio(src);
  a.loop = true;
  a.preload = "auto";
  a.setAttribute("playsinline", "");
  return a;
}

function elements() {
  keepAlive ??= make("/sounds/silence.wav");
  alarm ??= make("/sounds/alarm.wav");
  return { keepAlive, alarm };
}

function playbackSession() {
  // Safari 17+: wie eine Musik-App behandeln → ignoriert den Lautlos-Schalter
  try {
    const nav = navigator as AudioSessionNav;
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {}
}

/** Muss direkt in einem Tipp/Klick aufgerufen werden. */
export async function unlockAlarm(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  playbackSession();
  const { keepAlive: k, alarm: a } = elements();
  try {
    await k.play();
    a.muted = true;
    await a.play();
    a.pause();
    a.currentTime = 0;
    a.muted = false;
    unlocked = true;
  } catch {
    unlocked = false;
  }
  return unlocked;
}

/** Freigegeben und die Audio-Sitzung läuft noch (iOS stoppt sie z. B. nach einem Anruf). */
export function alarmReady() {
  return unlocked && !!keepAlive && !keepAlive.paused;
}

export function startAlarm() {
  const { alarm: a } = elements();
  playbackSession();
  a.loop = true;
  a.muted = false;
  a.currentTime = 0;
  a.play().catch(() => {});
}

export function stopAlarm() {
  if (alarm) {
    alarm.pause();
    alarm.currentTime = 0;
  }
}

/** Glocke aus: auch die Stille-Schleife beenden. */
export function releaseAlarm() {
  stopAlarm();
  keepAlive?.pause();
  unlocked = false;
}

/** „Ton testen“: 3 Sekunden Alarm (im Klick-Handler aufrufen). */
export async function testAlarm() {
  await unlockAlarm();
  startAlarm();
  setTimeout(stopAlarm, 3000);
}
