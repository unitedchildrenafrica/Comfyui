import { getPreview } from "@/lib/server/events";

export const dynamic = "force-dynamic";

export function GET() {
  const p = getPreview();
  if (!p) return new Response(null, { status: 204 });
  return new Response(new Uint8Array(p.data), { headers: { "content-type": p.mime, "cache-control": "no-store" } });
}
