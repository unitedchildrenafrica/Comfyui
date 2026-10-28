import { NextResponse } from "next/server";
import { ComfyPromptError, ComfyUnavailableError } from "./comfy";

/** Einheitliche Fehlerantwort für alle API-Routen. */
export function errorResponse(err: unknown) {
  if (err instanceof ComfyUnavailableError) {
    return NextResponse.json({ error: "ComfyUI antwortet nicht", code: "comfy_unavailable" }, { status: 503 });
  }
  if (err instanceof ComfyPromptError) {
    return NextResponse.json(
      { error: err.message, code: "prompt_error", node_errors: err.details.node_errors ?? {} },
      { status: 400 },
    );
  }
  console.error(err);
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
}

export function badRequest(message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}
