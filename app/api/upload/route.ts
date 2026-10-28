import type { NextRequest } from "next/server";
import { comfyFetch } from "@/lib/server/comfy";
import { badRequest, errorResponse } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Bilder UND Audio gehen über /upload/image in den input-Ordner. */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return badRequest("Keine Datei");
    const out = new FormData();
    out.append("image", file, file.name);
    out.append("type", "input");
    out.append("overwrite", "false");
    const res = await comfyFetch("/upload/image", { method: "POST", body: out, timeoutMs: 120_000 });
    if (!res.ok) return badRequest(`Upload fehlgeschlagen: ${await res.text()}`);
    const data = (await res.json()) as { name: string; subfolder?: string; type?: string };
    const filename = data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
    return Response.json({ filename, name: data.name, subfolder: data.subfolder ?? "" });
  } catch (err) {
    return errorResponse(err);
  }
}
