import { promises as fs } from "node:fs";
import type { NextRequest } from "next/server";
import { type MediaFile, getHistory } from "@/lib/server/history";
import { errorResponse } from "@/lib/server/http";
import { deletedKeys, listMirrored } from "@/lib/server/mirror";
import { serverMode } from "@/lib/server/podLink";
import { getJobs } from "@/lib/server/store";
import { outputDirAvailable, resolveOutputFile } from "@/lib/server/zip";

export const dynamic = "force-dynamic";

interface Row {
  file: MediaFile;
  promptId: string;
  timestamp: number;
  durationMs: number | null;
}

const key = (f: { subfolder: string; filename: string }) => `${f.subfolder}/${f.filename}`;

export async function GET(req: NextRequest) {
  try {
    const max = Math.min(2000, Number(req.nextUrl.searchParams.get("max") ?? 300) || 300);
    const server = serverMode();
    let rows: Row[] = [];

    // Live-Verlauf von ComfyUI. Im Server-Modus darf der Pod fehlen – dann zählt nur der Spiegel.
    try {
      const entries = (await getHistory(max)).filter((e) => e.files.length);
      rows = entries.flatMap((e) =>
        e.files.filter((f) => f.kind !== "audio").map((file) => ({ file, promptId: e.promptId, timestamp: e.timestamp, durationMs: e.durationMs })),
      );
    } catch (err) {
      if (!server) throw err;
    }

    const canCheck = await outputDirAvailable();
    if (server) {
      // Gespiegelte Dateien (auch von gelöschten/alten Pods) + Live-Einträge, die noch nicht kopiert sind
      const mirrored = await listMirrored();
      const deleted = await deletedKeys();
      const have = new Set(mirrored.map(key));
      const live = rows.filter((r) => !have.has(key(r.file)) && !deleted.has(key(r.file)));
      rows = [
        ...mirrored.map((m) => ({ file: { filename: m.filename, subfolder: m.subfolder, type: m.type, kind: m.kind }, promptId: m.promptId, timestamp: m.timestamp, durationMs: m.durationMs })),
        ...live,
      ];
    } else if (canCheck) {
      // Pod-Modus: Gelöschte Dateien stehen weiter im ComfyUI-Verlauf → nur zeigen, was noch da ist
      const keep = await Promise.all(
        rows.map((r) => {
          if (r.file.type !== "output") return true;
          const abs = resolveOutputFile(r.file.subfolder, r.file.filename);
          return abs ? fs.access(abs).then(() => true, () => false) : true;
        }),
      );
      rows = rows.filter((_, i) => keep[i]);
    }

    rows.sort((a, b) => b.timestamp - a.timestamp);
    rows = rows.slice(0, max);
    const jobs = await getJobs([...new Set(rows.map((r) => r.promptId))]);
    const items = rows.map((r) => ({
      ...r.file,
      promptId: r.promptId,
      timestamp: r.timestamp,
      durationMs: r.durationMs,
      folder: r.file.subfolder.split("/")[0] || "(ohne)",
      label: jobs[r.promptId]?.label ?? r.file.filename,
      generator: jobs[r.promptId]?.generator ?? null,
      seed: jobs[r.promptId]?.seed ?? null,
      hasSettings: !!jobs[r.promptId],
    }));
    return Response.json({ items, canDelete: canCheck });
  } catch (err) {
    return errorResponse(err);
  }
}
