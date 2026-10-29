import type { NextRequest } from "next/server";
import { getHistory } from "@/lib/server/history";
import { errorResponse } from "@/lib/server/http";
import { getJobs } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const max = Math.min(2000, Number(req.nextUrl.searchParams.get("max") ?? 300) || 300);
    const entries = (await getHistory(max)).filter((e) => e.files.length);
    const jobs = await getJobs(entries.map((e) => e.promptId));
    const items = entries.flatMap((e) =>
      e.files
        .filter((f) => f.kind !== "audio")
        .map((f) => ({
          ...f,
          promptId: e.promptId,
          timestamp: e.timestamp,
          durationMs: e.durationMs,
          folder: f.subfolder.split("/")[0] || "(ohne)",
          label: jobs[e.promptId]?.label ?? f.filename,
          generator: jobs[e.promptId]?.generator ?? null,
          seed: jobs[e.promptId]?.seed ?? null,
          hasSettings: !!jobs[e.promptId],
        })),
    );
    return Response.json({ items });
  } catch (err) {
    return errorResponse(err);
  }
}
