import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { deleteJob, getJob, jobAction } from "@/lib/server/knete";
import { summarize } from "@/lib/knete";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const job = await getJob((await params).id);
    if (!job) return Response.json({ error: "Auftrag nicht gefunden" }, { status: 404 });
    return Response.json({ job, summary: summarize(job) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST { action: "cancel" | "retry-failed" | "retry" | "resume", i? } */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const body = (await req.json()) as { action?: string; i?: number };
    const job = await jobAction((await params).id, body.action ?? "", body.i);
    return Response.json({ job, summary: summarize(job) });
  } catch (err) {
    return err instanceof Error ? badRequest(err.message) : errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    await deleteJob((await params).id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
