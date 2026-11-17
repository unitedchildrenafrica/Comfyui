import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { addRef, deleteRef, listRefs } from "@/lib/server/knete";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ refs: await listRefs() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) return badRequest("Keine Datei");
    const name = await addRef(Buffer.from(await file.arrayBuffer()));
    return Response.json({ name, refs: await listRefs() });
  } catch (err) {
    return err instanceof Error ? badRequest(err.message) : errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await deleteRef(req.nextUrl.searchParams.get("name") ?? "");
    return Response.json({ refs: await listRefs() });
  } catch (err) {
    return errorResponse(err);
  }
}
