import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { jobsForSets, listRestoreSets, podModelLists } from "@/lib/server/restore";
import { resubmitJobs } from "@/lib/server/submit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Zeitzone des Handys, damit „Einzelbilder vom 24.11.“ nach seinem Tag gruppiert werden */
const tz = (v: string | null) => {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= 900 ? n : 0;
};

/** GET /api/restore?tz=-60 – alle gespeicherten Sets (neueste zuerst) mit Modell-Status */
export async function GET(req: NextRequest) {
  try {
    return Response.json(await listRestoreSets(tz(req.nextUrl.searchParams.get("tz"))));
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST { keys: string[], tz } – gewählte Sets mit Original-Prompts und -Seeds neu einreihen */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { keys?: unknown; tz?: unknown };
    const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string").slice(0, 200) : [];
    if (!keys.length) return badRequest("Keine Sets gewählt");
    const lists = await podModelLists();
    if (!lists) return badRequest("Kein Pod erreichbar – erst einen Pod starten");
    const groups = await jobsForSets(keys, tz(String(body.tz ?? "")));
    if (!groups.length) return badRequest("Die gewählten Sets wurden nicht gefunden");
    return Response.json(await resubmitJobs(groups, lists));
  } catch (err) {
    return errorResponse(err);
  }
}
