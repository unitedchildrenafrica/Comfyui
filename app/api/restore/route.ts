import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { listRestoreSets, loadPlan, planRestore, podModelLists } from "@/lib/server/restore";
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

/**
 * POST { keys: string[], tz, dedupe?, dryRun? } – gewählte Sets mit Original-Prompts und -Seeds neu
 * einreihen. dedupe (Standard an): jede Ausgabedatei nur einmal, auch wenn derselbe Batch mehrmals
 * abgeschickt wurde. dryRun: nur zählen ({ jobs, skipped }).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { keys?: unknown; tz?: unknown; dedupe?: unknown; dryRun?: unknown };
    const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string").slice(0, 200) : [];
    if (!keys.length) return badRequest("Keine Sets gewählt");
    const plan = await planRestore(keys, tz(String(body.tz ?? "")), body.dedupe !== false);
    if (body.dryRun) return Response.json({ jobs: plan.jobs, skipped: plan.skipped });
    if (!plan.jobs) return badRequest("Die gewählten Sets wurden nicht gefunden");
    const lists = await podModelLists();
    if (!lists) return badRequest("Kein Pod erreichbar – erst einen Pod starten");
    const result = await resubmitJobs(await loadPlan(plan), lists);
    return Response.json({ ...result, skipped: plan.skipped });
  } catch (err) {
    return errorResponse(err);
  }
}
