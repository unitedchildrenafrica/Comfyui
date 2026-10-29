import { getPreview } from "@/lib/server/events";

export const dynamic = "force-dynamic";

/** Letzte Live-Vorschau. Mit Range-Unterstützung – iOS Safari spielt <video> sonst nicht ab. */
export function GET(req: Request) {
  const p = getPreview();
  if (!p) return new Response(null, { status: 204 });
  const total = p.data.length;
  const headers: Record<string, string> = { "content-type": p.mime, "cache-control": "no-store", "accept-ranges": "bytes" };
  const m = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : total - 1;
    end = Math.min(end, total - 1);
    start = Math.min(start, end);
    return new Response(new Uint8Array(p.data.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${total}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(new Uint8Array(p.data), { headers: { ...headers, "content-length": String(total) } });
}
