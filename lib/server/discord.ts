import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config";

// Discord-Benutzernamen zu den Discord-IDs, die Patreon liefert (verbundene Konten). Braucht einen
// Bot-Token (DISCORD_BOT_TOKEN, einmal per „bash /root/setup-server.sh discord“). Der Bot muss auf
// keinem Server sein – GET /users/{id} geht für jede ID. Der Token steht nie in Meldungen oder Dateien.

const API = () => (process.env.DISCORD_API_BASE || "https://discord.com").replace(/\/$/, "");
const FILE = () => config.dataPath("discord-names.json");
const FRESH_MS = 24 * 3600_000;
const MAX_PER_RUN = 200;
/** Kurze Bremse von Discord abwarten (Sekunden); bei längerer macht der nächste Durchlauf weiter */
const MAX_WAIT_S = 10;
const ID = /^\d{5,25}$/;

interface Entry {
  username?: string;
  globalName?: string | null;
  /** Discord kennt die ID nicht (gelöscht) */
  missing?: boolean;
  fetchedAt: number;
}

const g = globalThis as unknown as { __discord?: { running: Promise<void> | null; error: string | null } };
const st = (g.__discord ??= { running: null, error: null });

export const discordConfigured = () => !!process.env.DISCORD_BOT_TOKEN;
export const discordError = () => st.error;

async function readNames(): Promise<Record<string, Entry>> {
  try {
    return JSON.parse(await fs.readFile(FILE(), "utf8")) as Record<string, Entry>;
  } catch {
    return {};
  }
}

async function writeNames(names: Record<string, Entry>) {
  await fs.mkdir(path.dirname(FILE()), { recursive: true });
  const tmp = `${FILE()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(names, null, 1));
  await fs.rename(tmp, FILE());
}

/** Discord-ID → Benutzername (nur bekannte) */
export async function discordNameMap(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [id, e] of Object.entries(await readNames())) if (e.username) out[id] = e.username;
  return out;
}

/**
 * Fehlende oder über 24 h alte Namen nachholen – höchstens 200 pro Durchlauf, einer nach dem anderen.
 * Bremst Discord kurz (429, ≤ 10 s), wird gewartet und weitergemacht; bei längerer Bremse oder falschem
 * Token (401) wird abgebrochen – der alte Stand bleibt, der nächste Durchlauf macht weiter.
 */
export function refreshDiscordNames(ids: string[], now = Date.now()): Promise<void> {
  if (!discordConfigured()) return Promise.resolve();
  if (st.running) return st.running;
  st.running = (async () => {
    try {
      const names = await readNames();
      const todo = [...new Set(ids)].filter((id) => ID.test(id) && !(names[id] && now - names[id].fetchedAt < FRESH_MS)).slice(0, MAX_PER_RUN);
      let changed = false;
      const get = () =>
        fetch(`${API()}/api/v10/users/${todo[i]}`, {
          headers: { authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, "user-agent": "DiscordBot (pod-frontend, 1.0)" },
          signal: AbortSignal.timeout(10_000),
          cache: "no-store",
        });
      let i = 0;
      for (; i < todo.length; i++) {
        const id = todo[i];
        let res: Response;
        try {
          res = await get();
          // kurz gebremst: Wartezeit abwarten und dieselbe ID nochmal (höchstens dreimal)
          for (let tries = 0; res.status === 429 && tries < 3; tries++) {
            const wait = Number(((await res.json().catch(() => ({}))) as { retry_after?: unknown }).retry_after);
            if (!Number.isFinite(wait) || wait > MAX_WAIT_S) break;
            await new Promise((r) => setTimeout(r, Math.max(0, wait) * 1000 + 50));
            res = await get();
          }
        } catch {
          st.error = "Discord nicht erreichbar – später nochmal";
          break;
        }
        if (res.status === 401 || res.status === 403) {
          st.error = "Discord-Bot-Token ungültig – mit „bash /root/setup-server.sh discord“ neu eintragen";
          break;
        }
        if (res.status === 429) break; // nächster Durchlauf macht weiter
        if (res.status === 404) {
          names[id] = { missing: true, fetchedAt: now };
          changed = true;
          continue;
        }
        if (!res.ok) {
          st.error = `Discord-API: HTTP ${res.status}`;
          break;
        }
        const u = (await res.json().catch(() => ({}))) as { username?: unknown; global_name?: unknown };
        if (typeof u.username === "string" && u.username) {
          names[id] = { username: u.username.slice(0, 100), globalName: typeof u.global_name === "string" ? u.global_name.slice(0, 100) : null, fetchedAt: now };
          changed = true;
          st.error = null;
        }
      }
      if (changed) await writeNames(names);
    } finally {
      st.running = null;
    }
  })();
  return st.running;
}
