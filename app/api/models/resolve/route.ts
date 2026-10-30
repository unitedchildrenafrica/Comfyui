import type { NextRequest } from "next/server";
import { badRequest } from "@/lib/server/http";
import { resolveLink } from "@/lib/server/downloads";
import { forwardToPodApp } from "@/lib/server/podForward";
import { serverMode } from "@/lib/server/podLink";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (serverMode()) return forwardToPodApp(req, "/api/models/resolve");
  const { url, versionId } = (await req.json().catch(() => ({}))) as { url?: string; versionId?: number };
  if (!url) return badRequest("Link fehlt");
  try {
    return Response.json(await resolveLink(url, versionId));
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : String(err));
  }
}
