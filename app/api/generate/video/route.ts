import type { NextRequest } from "next/server";
import { H3_MAX_AUDIO, H3_MAX_IMAGES } from "@/lib/builders/h3";
import { badRequest, errorResponse } from "@/lib/server/http";
import { BatchParseError, submitVideoBatch, submitVideoJob } from "@/lib/server/submit";
import type { H3Settings } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { settings } = (await req.json()) as { settings: H3Settings };
    if (!settings?.mode) return badRequest("Ungültige Einstellungen");
    const images = settings.refs.filter((r) => r.kind === "image").length;
    const audios = settings.refs.filter((r) => r.kind === "audio").length;
    if (images > H3_MAX_IMAGES) return badRequest(`Höchstens ${H3_MAX_IMAGES} Referenzbilder`);
    if (audios > H3_MAX_AUDIO) return badRequest(`Höchstens ${H3_MAX_AUDIO} Audio-Referenzen`);
    if (settings.promptInput === "batch") return Response.json(await submitVideoBatch(settings));
    const single = await submitVideoJob(settings);
    return Response.json({ ...single, promptIds: [single.promptId], seeds: [single.seed] });
  } catch (err) {
    if (err instanceof BatchParseError) return badRequest(err.message, { batchErrors: err.errors });
    return errorResponse(err);
  }
}
