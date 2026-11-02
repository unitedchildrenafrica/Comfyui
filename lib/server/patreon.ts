import { promises as fs } from "node:fs";
import path from "node:path";
import { type PatreonMember, type PatreonTier, defaultTiers } from "../patreon";
import { config } from "./config";

// Patreon API v2 (https://docs.patreon.com): Mitglieder der eigenen Kampagne abfragen.
// Zugang über den „Creator's Access Token“ aus dem Patreon-Portal. Läuft er ab, wird er mit dem
// Refresh-Token erneuert; die neuen Tokens liegen in DATA_DIR/patreon-tokens.json (nur für den
// Dienst lesbar). Die Erstwerte kommen aus der Umgebung (/etc/pod-frontend.env).

const API = () => (process.env.PATREON_API_BASE || "https://www.patreon.com").replace(/\/$/, "");
const UA = "ComfyPortal/1.0 (+https://comfy.comfyusel.uk)";
const SYNC_MS = 60 * 60_000;

interface Tokens {
  access: string;
  refresh: string;
  /** ms, 0 = unbekannt */
  expiresAt: number;
  /** Refresh-Token aus der Umgebung, von dem diese Tokens abstammen */
  seededFrom?: string;
}

export interface Snapshot {
  syncedAt: number;
  campaignId: string;
  tiers: PatreonTier[];
  members: PatreonMember[];
}

interface State {
  tokens: Tokens | null;
  syncing: Promise<Snapshot> | null;
  lastError: string | null;
  timer: ReturnType<typeof setInterval> | null;
}
const g = globalThis as unknown as { __patreon?: State };
const st = (g.__patreon ??= { tokens: null, syncing: null, lastError: null, timer: null });

const file = (name: string) => config.dataPath(name);

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file(name), "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(name: string, data: unknown, mode = 0o600) {
  const f = file(name);
  await fs.mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 1), { mode });
  await fs.rename(tmp, f);
}

export function patreonConfigured() {
  return !!(process.env.PATREON_ACCESS_TOKEN || process.env.PATREON_REFRESH_TOKEN);
}

async function tokens(): Promise<Tokens> {
  if (st.tokens) return st.tokens;
  const saved = await readJson<Tokens | null>("patreon-tokens.json", null);
  // Gespeicherte (erneuerte) Tokens haben Vorrang – außer in der Umgebung steht ein neuer Refresh-Token
  if (saved?.access && (!process.env.PATREON_REFRESH_TOKEN || saved.seededFrom === process.env.PATREON_REFRESH_TOKEN)) {
    st.tokens = saved;
  } else {
    st.tokens = { access: process.env.PATREON_ACCESS_TOKEN || "", refresh: process.env.PATREON_REFRESH_TOKEN || "", expiresAt: 0 };
  }
  return st.tokens;
}

async function refresh(): Promise<Tokens> {
  const t = await tokens();
  const id = process.env.PATREON_CLIENT_ID;
  const secret = process.env.PATREON_CLIENT_SECRET;
  if (!t.refresh || !id || !secret) throw new Error("Patreon-Token abgelaufen – zum Erneuern fehlen Refresh-Token, Client ID oder Client Secret");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: id, client_secret: secret });
  const res = await fetch(`${API()}/api/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`Patreon-Token erneuern fehlgeschlagen (HTTP ${res.status}${data.error ? `, ${data.error}` : ""})`);
  st.tokens = {
    access: data.access_token,
    refresh: data.refresh_token || t.refresh,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : 0,
  };
  await writeJson("patreon-tokens.json", { ...st.tokens, seededFrom: process.env.PATREON_REFRESH_TOKEN || "" });
  return st.tokens;
}

/** GET auf die Patreon-API; bei 401 einmal Token erneuern und wiederholen. */
async function get<T>(pathAndQuery: string): Promise<T> {
  let t = await tokens();
  // Läuft der Token in den nächsten 2 Tagen ab, vorher erneuern
  if (t.expiresAt && t.expiresAt - Date.now() < 2 * 86_400_000) t = await refresh().catch(() => t);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${API()}${pathAndQuery}`, {
      headers: { authorization: `Bearer ${t.access}`, "user-agent": UA },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (res.status === 401 && attempt === 0) {
      t = await refresh();
      continue;
    }
    if (res.status === 429) {
      const retry = Number((await res.json().catch(() => ({})) as { retry_after_seconds?: number }).retry_after_seconds) || 60;
      throw new Error(`Patreon bremst gerade (zu viele Anfragen) – in ${retry} s nochmal`);
    }
    if (!res.ok) throw new Error(`Patreon-API: HTTP ${res.status}`);
    return (await res.json()) as T;
  }
  throw new Error("Patreon-API: Zugang verweigert (Token prüfen)");
}

interface JsonApi {
  data: { id: string; type: string; attributes: Record<string, unknown>; relationships?: Record<string, { data: { id: string; type: string }[] | { id: string; type: string } | null }> }[];
  included?: { id: string; type: string; attributes: Record<string, unknown> }[];
  meta?: { pagination?: { cursors?: { next?: string | null } } };
}

const enc = (s: string) => s.replace(/\[/g, "%5B").replace(/\]/g, "%5D");
const str = (v: unknown) => (typeof v === "string" ? v : null);

export async function syncPatreon(): Promise<Snapshot> {
  if (st.syncing) return st.syncing;
  st.syncing = (async () => {
    try {
      const camp = await get<JsonApi>(enc(`/api/oauth2/v2/campaigns?include=tiers&fields[tier]=title,amount_cents`));
      const campaign = camp.data[0];
      if (!campaign) throw new Error("Keine Patreon-Kampagne zu diesem Token gefunden");
      const tiers: PatreonTier[] = (camp.included ?? [])
        .filter((x) => x.type === "tier")
        .map((x) => ({ id: x.id, title: str(x.attributes.title) ?? "Stufe", amountCents: Number(x.attributes.amount_cents) || 0 }))
        .sort((a, b) => a.amountCents - b.amountCents);

      const members: PatreonMember[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 50; page++) {
        const q: string =
          `/api/oauth2/v2/campaigns/${campaign.id}/members?include=currently_entitled_tiers,user` +
          `&fields[member]=full_name,email,patron_status,last_charge_date,last_charge_status,next_charge_date,pledge_relationship_start,currently_entitled_amount_cents,pledge_cadence` +
          `&fields[user]=url&page[count]=1000` +
          (cursor ? `&page[cursor]=${encodeURIComponent(cursor)}` : "");
        const res: JsonApi = await get<JsonApi>(enc(q));
        const users = new Map((res.included ?? []).filter((x) => x.type === "user").map((u) => [u.id, u]));
        for (const m of res.data) {
          const a = m.attributes;
          const tierRel = m.relationships?.currently_entitled_tiers?.data;
          const userRel = m.relationships?.user?.data;
          const userId = userRel && !Array.isArray(userRel) ? userRel.id : null;
          members.push({
            id: m.id,
            name: str(a.full_name) ?? "?",
            email: str(a.email) ?? "",
            status: str(a.patron_status),
            lastCharge: str(a.last_charge_date),
            lastChargeStatus: str(a.last_charge_status),
            nextCharge: str(a.next_charge_date),
            since: str(a.pledge_relationship_start),
            cents: Number(a.currently_entitled_amount_cents) || 0,
            cadence: typeof a.pledge_cadence === "number" ? a.pledge_cadence : null,
            tierIds: Array.isArray(tierRel) ? tierRel.map((t) => t.id) : [],
            url: userId ? str(users.get(userId)?.attributes.url) : null,
          });
        }
        cursor = res.meta?.pagination?.cursors?.next ?? null;
        if (!cursor) break;
      }
      const snap: Snapshot = { syncedAt: Date.now(), campaignId: campaign.id, tiers, members };
      await writeJson("patreon-members.json", snap);
      st.lastError = null;
      return snap;
    } catch (err) {
      st.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      st.syncing = null;
    }
  })();
  return st.syncing;
}

/** Stündlich im Hintergrund abfragen (einmalig gestartet) */
export function startPatreonLoop() {
  if (st.timer || !patreonConfigured()) return;
  st.timer = setInterval(() => syncPatreon().catch(() => {}), SYNC_MS);
  st.timer.unref?.();
}

export async function getSnapshot(): Promise<Snapshot | null> {
  return readJson<Snapshot | null>("patreon-members.json", null);
}

export const patreonError = () => st.lastError;

// --- Häkchen „angeschrieben“ und Stufen-Auswahl ------------------------------------------

export async function getAcks(): Promise<Record<string, string>> {
  return readJson<Record<string, string>>("patreon-acks.json", {});
}

let ackQueue: Promise<unknown> = Promise.resolve();
export function setAcks(update: (acks: Record<string, string>) => void): Promise<Record<string, string>> {
  const run = async () => {
    const acks = await getAcks();
    update(acks);
    await writeJson("patreon-acks.json", acks);
    return acks;
  };
  const next = ackQueue.then(run, run);
  ackQueue = next.catch(() => {});
  return next;
}

export async function getTrackedTiers(snap: Snapshot | null): Promise<string[] | null> {
  const s = await readJson<{ tiers?: string[] | null } | null>("patreon-settings.json", null);
  if (s && "tiers" in s) return s.tiers ?? null;
  return snap ? defaultTiers(snap.tiers) : null;
}

export async function setTrackedTiers(tiers: string[] | null) {
  await writeJson("patreon-settings.json", { tiers }, 0o644);
}
