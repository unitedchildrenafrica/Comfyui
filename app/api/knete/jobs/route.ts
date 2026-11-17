import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { createJob, listJobs, openaiKey } from "@/lib/server/knete";
import { summarize } from "@/lib/knete";

export const dynamic = "force-dynamic";

/** GET → Übersicht aller Aufträge (neueste zuerst) */
export async function GET() {
  try {
    return Response.json({ jobs: (await listJobs()).map(summarize), keySet: !!openaiKey() });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST { folder? } → neuer Auftrag mit den aktuellen Referenzen und Einstellungen */
export async function POST(req: NextRequest) {
  try {
    if (!openaiKey()) return badRequest("OPENAI_API_KEY ist nicht gesetzt");
    const body = (await req.json().catch(() => ({}))) as { folder?: string };
    return Response.json({ job: await createJob(body.folder) });
  } catch (err) {
    return err instanceof Error ? badRequest(err.message) : errorResponse(err);
  }
}
