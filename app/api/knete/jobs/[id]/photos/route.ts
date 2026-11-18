import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { addPhoto } from "@/lib/server/knete";

export const dynamic = "force-dynamic";

/** POST multipart „file“ → ein Foto zum Auftrag; wird sofort in die Warteschlange gestellt. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) return badRequest("Keine Datei");
    const item = await addPhoto((await params).id, Buffer.from(await file.arrayBuffer()), file.name || "foto.jpg");
    return Response.json({ item });
  } catch (err) {
    return err instanceof Error ? badRequest(err.message) : errorResponse(err);
  }
}
