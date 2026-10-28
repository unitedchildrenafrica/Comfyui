import type { NextRequest } from "next/server";
import { clearNodeInfoCache } from "@/lib/server/comfy";
import { errorResponse } from "@/lib/server/http";
import { getOptions } from "@/lib/server/options";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get("refresh")) clearNodeInfoCache();
    return Response.json(await getOptions());
  } catch (err) {
    return errorResponse(err);
  }
}
