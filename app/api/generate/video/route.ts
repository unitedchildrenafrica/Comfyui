import type { NextRequest } from "next/server";
import { H3_MAX_AUDIO, H3_MAX_IMAGES, H3_MAX_VIDEOS } from "@/lib/builders/h3";
import { REF_MAX_FILES, refHasSound } from "@/lib/h3refs";
import { badRequest, errorResponse } from "@/lib/server/http";
import { BatchParseError, submitVideoBatch, submitVideoJob } from "@/lib/server/submit";
import type { H3Settings } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { settings } = (await req.json()) as { settings: H3Settings };
    if (!settings?.mode) return badRequest("Ungültige Einstellungen");
    const refs = settings.refs ?? [];
    const images = refs.filter((r) => r.kind === "image").length;
    const videos = refs.filter((r) => r.kind === "video").length;
    const sounds = refs.filter(refHasSound).length;
    if (images > H3_MAX_IMAGES) return badRequest(`Höchstens ${H3_MAX_IMAGES} Referenzbilder`);
    if (videos > H3_MAX_VIDEOS) return badRequest(`Höchstens ${H3_MAX_VIDEOS} Video-Referenzen`);
    if (sounds > H3_MAX_AUDIO) return badRequest(`Höchstens ${H3_MAX_AUDIO} Tonspuren (Audios + Videos mit Ton)`);
    if (refs.length > REF_MAX_FILES) return badRequest(`Höchstens ${REF_MAX_FILES} Referenzen insgesamt`);
    if (settings.promptInput === "batch") return Response.json(await submitVideoBatch(settings));
    const single = await submitVideoJob(settings);
    return Response.json({ ...single, promptIds: [single.promptId], seeds: [single.seed] });
  } catch (err) {
    if (err instanceof BatchParseError) return badRequest(err.message, { batchErrors: err.errors });
    return errorResponse(err);
  }
}
