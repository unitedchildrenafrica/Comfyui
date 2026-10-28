import type { NextRequest } from "next/server";
import { postJson } from "@/lib/server/comfy";
import { getLiveState } from "@/lib/server/events";
import { getHistory, getQueue } from "@/lib/server/history";
import { errorResponse } from "@/lib/server/http";
import { getBatch } from "@/lib/server/store";

export const dynamic = "force-dynamic";

async function status(id: string) {
  const batch = await getBatch(id);
  if (!batch) return null;
  const q = await getQueue();
  const ids = new Set(batch.promptIds);
  const running = q.running.filter((e) => ids.has(e.promptId)).map((e) => e.promptId);
  const pending = q.pending.filter((e) => ids.has(e.promptId)).map((e) => e.promptId);
  const history = await getHistory(Math.min(2000, batch.total + 50));
  const live = getLiveState();
  const failed = history.filter((h) => ids.has(h.promptId) && h.status === "error").map((h) => h.promptId);
  for (const pid of batch.promptIds) if (live.errors[pid] && !failed.includes(pid)) failed.push(pid);
  const done = batch.promptIds.length - running.length - pending.length;
  return { batch, running, pending, done, failed, total: batch.total };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const s = await status((await params).id);
    return s ? Response.json(s) : Response.json({ error: "Batch nicht gefunden" }, { status: 404 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Abbrechen: wartende Jobs löschen, laufenden Job des Batches unterbrechen. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const s = await status((await params).id);
    if (!s) return Response.json({ error: "Batch nicht gefunden" }, { status: 404 });
    if (s.pending.length) await postJson("/queue", { delete: s.pending });
    for (const pid of s.running) await postJson("/interrupt", { prompt_id: pid });
    return Response.json({ ok: true, deleted: s.pending.length, interrupted: s.running.length });
  } catch (err) {
    return errorResponse(err);
  }
}
