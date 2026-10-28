import { getLiveState } from "@/lib/server/events";
import { getHistoryEntry } from "@/lib/server/history";
import { errorResponse } from "@/lib/server/http";
import { getJob } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** Job-Settings + aktueller Status/Outputs (Fallback zum WebSocket: alle 2 s pollen). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [job, history] = await Promise.all([getJob(id), getHistoryEntry(id).catch(() => null)]);
    const live = getLiveState();
    return Response.json({
      job,
      history,
      running: live.runningPromptId === id,
      progress: live.runningPromptId === id ? live.progress : null,
      error: live.errors[id] ?? (history?.error ? { message: history.error } : null),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
