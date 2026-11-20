import { postJson } from "@/lib/server/comfy";
import { onPodOrAll } from "@/lib/server/podOps";
import { errorResponse } from "@/lib/server/http";

/** { pod? } – nur diesen Pod, sonst alle */
export async function POST(req: Request) {
  try {
    const { pod } = (await req.json().catch(() => ({}))) as { pod?: string };
    await onPodOrAll(pod, () => postJson("/free", { unload_models: true, free_memory: true }));
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
