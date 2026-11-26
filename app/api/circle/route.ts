import type { NextRequest } from "next/server";
import type { ManualMember } from "@/lib/circle";
import { badRequest, errorResponse } from "@/lib/server/http";
import { CircleError, addManual, circleView, editManual, paidManual, removeManual, setCycleField, setPersonField } from "@/lib/server/circle";
import { getSnapshot, patreonConfigured, setTrackedTiers, startPatreonLoop, syncPatreon } from "@/lib/server/patreon";

export const dynamic = "force-dynamic";

/** Mitglieder-Tabelle. Patreon-Stand älter als eine Stunde (oder keiner) → vorher abfragen. */
export async function GET() {
  try {
    if (patreonConfigured()) {
      startPatreonLoop();
      const snap = await getSnapshot();
      if (!snap || Date.now() - snap.syncedAt > 60 * 60_000) await syncPatreon().catch(() => {});
    }
    return Response.json(await circleView());
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * { action: "sync" }                                   – Patreon jetzt abfragen
 * { action: "cycle", key, cycleId, field, value }      – angeschrieben/answer/hasIt ("yes"|"no"|null) oder set (Text|null)
 * { action: "person", key, field, value }              – discord / bot / note
 * { action: "add", member }                            – Hand-Mitglied anlegen
 * { action: "edit", key, member }                      – Hand-Mitglied ändern (auch ended)
 * { action: "remove", key }                            – Hand-Mitglied löschen
 * { action: "paid", key, today }                       – Hand-Mitglied: Zahlung erhalten (today = JJJJ-MM-TT)
 * { action: "tiers", tiers }                           – welche Patreon-Stufen (null = alle)
 */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const key = typeof b.key === "string" ? b.key : "";
    switch (b.action) {
      case "sync":
        if (!patreonConfigured()) return badRequest("Patreon ist noch nicht eingerichtet");
        await syncPatreon();
        break;
      case "cycle":
        await setCycleField(key, String(b.cycleId ?? ""), b.field as "contacted", (b.value ?? null) as string | null);
        break;
      case "person":
        await setPersonField(key, b.field as "discord", typeof b.value === "string" ? b.value : "");
        break;
      case "add":
        await addManual((b.member ?? {}) as Partial<ManualMember>);
        break;
      case "edit":
        await editManual(key, (b.member ?? {}) as Partial<ManualMember>);
        break;
      case "remove":
        await removeManual(key);
        break;
      case "paid":
        await paidManual(key, String(b.today ?? ""));
        break;
      case "tiers":
        await setTrackedTiers(Array.isArray(b.tiers) ? b.tiers.filter((t): t is string => typeof t === "string") : null);
        break;
      default:
        return badRequest("Unbekannte Aktion");
    }
    return Response.json(await circleView());
  } catch (err) {
    if (err instanceof CircleError) return badRequest(err.message);
    return errorResponse(err);
  }
}
