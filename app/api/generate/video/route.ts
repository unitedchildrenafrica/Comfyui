import type { NextRequest } from "next/server";
import { refLimitError } from "@/lib/h3refs";
import { badRequest, errorResponse } from "@/lib/server/http";
import { BatchParseError, submitVideoBatch, submitVideoJob } from "@/lib/server/submit";
import type { H3Settings } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { settings } = (await req.json()) as { settings: H3Settings };
    if (!settings?.mode) return badRequest("Ungültige Einstellungen");
    // Im Batch prüft der Parser jeden Clip mit seinem eigenen Ref-Tab
    if (settings.promptInput === "batch") return Response.json(await submitVideoBatch(settings));
    const limit = refLimitError(settings.refs ?? []);
    if (limit) return badRequest(limit);
    const single = await submitVideoJob(settings);
    return Response.json({ ...single, promptIds: [single.promptId], seeds: [single.seed] });
  } catch (err) {
    if (err instanceof BatchParseError) return badRequest(err.message, { batchErrors: err.errors });
    return errorResponse(err);
  }
}
