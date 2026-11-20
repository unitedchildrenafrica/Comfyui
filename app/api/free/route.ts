import { postJson } from "@/lib/server/comfy";
import { onAllPods } from "@/lib/server/podOps";
import { errorResponse } from "@/lib/server/http";

export async function POST() {
  try {
    // bei zwei Pods auf beiden
    await onAllPods(() => postJson("/free", { unload_models: true, free_memory: true }));
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
