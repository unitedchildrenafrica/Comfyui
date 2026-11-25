import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { BatchParseError, PreflightError, submitImageJobs } from "@/lib/server/submit";
import type { ImageSettings } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { settings } = (await req.json()) as { settings: ImageSettings };
    if (!settings || !["wai", "pony", "anima", "krea2"].includes(settings.generator)) return badRequest("Ungültige Einstellungen");
    return Response.json(await submitImageJobs(settings));
  } catch (err) {
    if (err instanceof BatchParseError) return badRequest(err.message, { batchErrors: err.errors });
    if (err instanceof PreflightError)
      return badRequest("Krea 2 kann so nicht starten", { batchErrors: err.problems.map((message) => ({ block: 0, message })) });
    return errorResponse(err);
  }
}
