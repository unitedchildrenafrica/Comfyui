import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLink } from "@/lib/server/downloads";

afterEach(() => vi.unstubAllGlobals());

describe("resolveLink bei gesperrter Civitai-API (451)", () => {
  it("fällt auf den Download-Link zurück", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/v1/")) return new Response("blocked", { status: 451 });
      return new Response(null, {
        status: 206,
        headers: {
          "content-range": "bytes 0-0/228453892",
          "content-disposition": 'attachment; filename="Anima-lois-griffin_epoch_12.safetensors"',
        },
      });
    });
    const r = await resolveLink("https://civitai.red/api/download/models/2981403?fileId=2860917");
    expect(r.notice).toContain("451");
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toMatchObject({
      filename: "Anima-lois-griffin_epoch_12.safetensors",
      sizeBytes: 228453892,
      url: "https://civitai.red/api/download/models/2981403?fileId=2860917",
    });
    expect(calls.some((c) => c.includes("/api/download/models/2981403"))).toBe(true);
  });

  it("Modellseite ohne Version → Hinweis auf Download-Link", async () => {
    vi.stubGlobal("fetch", async () => new Response("blocked", { status: 451 }));
    await expect(resolveLink("https://civitai.red/models/2655140")).rejects.toThrow(/Download-Link/);
  });
});
