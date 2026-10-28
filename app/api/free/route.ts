import { postJson } from "@/lib/server/comfy";
import { errorResponse } from "@/lib/server/http";

export async function POST() {
  try {
    await postJson("/free", { unload_models: true, free_memory: true });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
