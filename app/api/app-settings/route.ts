import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http";
import { type AppSettings, getAppSettings, saveAppSettings } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getAppSettings());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as AppSettings;
    await saveAppSettings({ ...(await getAppSettings()), ...body });
    return Response.json(await getAppSettings());
  } catch (err) {
    return errorResponse(err);
  }
}
