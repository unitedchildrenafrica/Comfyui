import type { NextRequest } from "next/server";
import { comfyFetch } from "@/lib/server/comfy";
import { badRequest, errorResponse } from "@/lib/server/http";
import { saveRefCopy } from "@/lib/server/refs";

export const dynamic = "force-dynamic";

/** Bilder UND Audio gehen über /upload/image in den input-Ordner. */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return badRequest("Keine Datei");
    const data = Buffer.from(await file.arrayBuffer());
    const out = new FormData();
    out.append("image", new Blob([new Uint8Array(data)], { type: file.type }), file.name);
    out.append("type", "input");
    out.append("overwrite", "false");
    const res = await comfyFetch("/upload/image", { method: "POST", body: out, timeoutMs: 120_000 });
    if (!res.ok) return badRequest(`Upload fehlgeschlagen: ${await res.text()}`);
    const result = (await res.json()) as { name: string; subfolder?: string; type?: string };
    const filename = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
    // Server-Modus: Kopie behalten – auf einem neuen Pod wird sie vor dem Video wieder hochgeladen
    await saveRefCopy(filename, data).catch(() => {});
    return Response.json({ filename, name: result.name, subfolder: result.subfolder ?? "" });
  } catch (err) {
    return errorResponse(err);
  }
}
