import { comfyJson } from "@/lib/server/comfy";
import { getLiveState } from "@/lib/server/events";
import { errorResponse } from "@/lib/server/http";

export const dynamic = "force-dynamic";

interface SystemStats {
  system?: { comfyui_version?: string; python_version?: string; pytorch_version?: string; ram_total?: number; ram_free?: number };
  devices?: { name?: string; type?: string; vram_total?: number; vram_free?: number }[];
}

export async function GET() {
  try {
    const stats = await comfyJson<SystemStats>("/system_stats", { timeoutMs: 5000 });
    const gpu = stats.devices?.[0];
    return Response.json({
      ok: true,
      comfyVersion: stats.system?.comfyui_version ?? "?",
      pytorch: stats.system?.pytorch_version,
      gpu: gpu?.name ?? "?",
      vramTotal: gpu?.vram_total ?? 0,
      vramFree: gpu?.vram_free ?? 0,
      ramTotal: stats.system?.ram_total ?? 0,
      ramFree: stats.system?.ram_free ?? 0,
      wsConnected: getLiveState().connected,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
