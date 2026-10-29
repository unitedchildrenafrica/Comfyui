import type { NextRequest } from "next/server";
import { postJson } from "@/lib/server/comfy";
import { getLiveState } from "@/lib/server/events";
import { getHistory, getQueue } from "@/lib/server/history";
import { badRequest, errorResponse } from "@/lib/server/http";
import { getJobs } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [q, history] = await Promise.all([getQueue(), getHistory(8).catch(() => [])]);
    const ids = [...q.running, ...q.pending].map((e) => e.promptId);
    const jobs = await getJobs([...ids.slice(0, 500), ...history.map((h) => h.promptId)]);
    const describe = (e: { number: number; promptId: string }) => {
      const j = jobs[e.promptId];
      return {
        ...e,
        label: j?.label ?? "Fremder Job",
        generator: j?.generator ?? null,
        kind: j?.kind ?? null,
        batchId: j?.batchId ?? null,
        createdAt: j?.createdAt ?? null,
      };
    };
    const { finished: _f, errors: _e, durations: _d, ...live } = getLiveState();
    const recent = history.map((h) => ({
      promptId: h.promptId,
      label: jobs[h.promptId]?.label ?? h.files[0]?.filename ?? "Job",
      generator: jobs[h.promptId]?.generator ?? null,
      status: h.status,
      durationMs: h.durationMs ?? getLiveState().durations[h.promptId] ?? null,
      timestamp: h.timestamp,
    }));
    return Response.json({ running: q.running.map(describe), pending: q.pending.map(describe), recent, live });
  } catch (err) {
    return errorResponse(err);
  }
}

/** { action: "delete", ids } | { action: "interrupt", promptId? } | { action: "clear" } */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { action: string; ids?: string[]; promptId?: string };
    if (body.action === "delete") {
      if (!Array.isArray(body.ids) || !body.ids.length) return badRequest("ids fehlen");
      await postJson("/queue", { delete: body.ids });
    } else if (body.action === "interrupt") {
      await postJson("/interrupt", body.promptId ? { prompt_id: body.promptId } : {});
    } else if (body.action === "clear") {
      await postJson("/queue", { clear: true });
      await postJson("/interrupt", {});
    } else return badRequest("Unbekannte Aktion");
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
