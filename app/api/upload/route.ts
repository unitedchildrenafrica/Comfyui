import type { NextRequest } from "next/server";
import { ComfyUnavailableError, comfyFetch } from "@/lib/server/comfy";
import { badRequest, errorResponse } from "@/lib/server/http";
import { serverMode, withRole } from "@/lib/server/podLink";
import { offlineName, refCopyPath, saveRefCopy } from "@/lib/server/refs";

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
    let res: Response;
    try {
      // Referenzen sind für H3 → auf den Video-Pod
      res = await withRole("video", () => comfyFetch("/upload/image", { method: "POST", body: out, timeoutMs: 120_000 }));
    } catch (err) {
      // Server-Modus und Pod gerade weg: nur auf dem Server ablegen. Vor dem nächsten Video wird
      // die Datei automatisch auf den Pod geladen (ensureRefsOnPod) – Ref-Tabs lassen sich so
      // auch ohne laufenden Pod vorbereiten.
      if (!(serverMode() && err instanceof ComfyUnavailableError)) throw err;
      const filename = offlineName(file.name);
      if (!refCopyPath(filename)) throw err;
      await saveRefCopy(filename, data);
      return Response.json({ filename, name: filename, subfolder: "", pending: true });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // keine HTML-Fehlerseiten in die Meldung kippen
      return badRequest(`Upload fehlgeschlagen (HTTP ${res.status})${text && !text.trimStart().startsWith("<") ? `: ${text.slice(0, 300)}` : ""}`);
    }
    const result = (await res.json()) as { name: string; subfolder?: string; type?: string };
    const filename = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
    // Server-Modus: Kopie behalten – auf einem neuen Pod wird sie vor dem Video wieder hochgeladen
    await saveRefCopy(filename, data).catch(() => {});
    return Response.json({ filename, name: result.name, subfolder: result.subfolder ?? "" });
  } catch (err) {
    return errorResponse(err);
  }
}
