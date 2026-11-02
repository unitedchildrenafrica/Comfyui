import type { NextRequest } from "next/server";
import { viewMembers } from "@/lib/patreon";
import { badRequest, errorResponse } from "@/lib/server/http";
import {
  getAcks,
  getSnapshot,
  getTrackedTiers,
  patreonConfigured,
  patreonError,
  setAcks,
  setTrackedTiers,
  startPatreonLoop,
  syncPatreon,
} from "@/lib/server/patreon";

export const dynamic = "force-dynamic";

async function view() {
  const snap = await getSnapshot();
  const tracked = await getTrackedTiers(snap);
  const acks = await getAcks();
  return {
    configured: patreonConfigured(),
    syncedAt: snap?.syncedAt ?? null,
    error: patreonError(),
    tiers: snap?.tiers ?? [],
    trackedTiers: tracked,
    members: snap ? viewMembers(snap.members, acks, tracked) : [],
  };
}

/** Mitgliederliste (letzter Stand). Beim ersten Aufruf ohne Stand wird sofort abgefragt. */
export async function GET() {
  try {
    if (!patreonConfigured()) return Response.json(await view());
    startPatreonLoop();
    // Noch nie oder vor über einer Stunde abgefragt → jetzt holen
    const snap = await getSnapshot();
    if (!snap || Date.now() - snap.syncedAt > 60 * 60_000) await syncPatreon().catch(() => {});
    return Response.json(await view());
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * { action: "sync" }                         – jetzt abfragen
 * { action: "ack", memberId, charge }        – angeschrieben (für diese Abbuchung)
 * { action: "unack", memberId }              – Häkchen zurücknehmen
 * { action: "ack-all", members: [{ memberId, charge }] }
 * { action: "tiers", tiers: string[] | null } – welche Stufen in die Liste kommen (null = alle)
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action?: string;
      memberId?: string;
      charge?: string;
      members?: { memberId: string; charge: string }[];
      tiers?: string[] | null;
    };
    switch (body.action) {
      case "sync":
        if (!patreonConfigured()) return badRequest("Patreon ist noch nicht eingerichtet");
        await syncPatreon();
        break;
      case "ack":
        if (!body.memberId || !body.charge) return badRequest("memberId/charge fehlt");
        await setAcks((a) => {
          a[body.memberId!] = body.charge!;
        });
        break;
      case "unack":
        if (!body.memberId) return badRequest("memberId fehlt");
        await setAcks((a) => {
          delete a[body.memberId!];
        });
        break;
      case "ack-all":
        await setAcks((a) => {
          for (const m of body.members ?? []) if (m?.memberId && m.charge) a[m.memberId] = m.charge;
        });
        break;
      case "tiers":
        await setTrackedTiers(Array.isArray(body.tiers) ? body.tiers.filter((t) => typeof t === "string") : null);
        break;
      default:
        return badRequest("Unbekannte Aktion");
    }
    return Response.json(await view());
  } catch (err) {
    return errorResponse(err);
  }
}
