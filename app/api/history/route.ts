import type { NextRequest } from "next/server";
import { getHistory } from "@/lib/server/history";
import { errorResponse } from "@/lib/server/http";
import { getJobs } from "@/lib/server/store";
import { outputDirAvailable, resolveOutputFile } from "@/lib/server/zip";
import { promises as fs } from "node:fs";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const max = Math.min(2000, Number(req.nextUrl.searchParams.get("max") ?? 300) || 300);
    const entries = (await getHistory(max)).filter((e) => e.files.length);
    const jobs = await getJobs(entries.map((e) => e.promptId));
    // Gelöschte Dateien stehen weiter im ComfyUI-Verlauf → nur zeigen, was noch auf der Platte liegt
    const canCheck = await outputDirAvailable();
    const exists = async (f: { filename: string; subfolder: string; type: string }) => {
      if (!canCheck || f.type !== "output") return true;
      const abs = resolveOutputFile(f.subfolder, f.filename);
      return abs ? fs.access(abs).then(() => true, () => false) : true;
    };
    const all = entries.flatMap((e) =>
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
    const keep = await Promise.all(all.map(exists));
    const items = all.filter((_, i) => keep[i]);
    return Response.json({ items, canDelete: canCheck });
  } catch (err) {
    return errorResponse(err);
  }
}
