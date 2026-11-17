import { describe, expect, it } from "vitest";
import {
  costFromUsage,
  describeOpenAIError,
  isFatalOpenAIError,
  isRetryableStatus,
  normalizeKneteSettings,
  outputSize,
  safeBase,
  safeFolder,
} from "@/lib/knete";

describe("knete outputSize", () => {
  const check = (s: string) => {
    const [w, h] = s.split("x").map(Number);
    expect(w % 16).toBe(0);
    expect(h % 16).toBe(0);
    expect(Math.max(w, h) / Math.min(w, h)).toBeLessThanOrEqual(3);
    return [w, h];
  };
  it("keeps the photo's aspect ratio with the long side = target", () => {
    expect(check(outputSize(3024, 4032, "1536"))).toEqual([1152, 1536]);
    expect(check(outputSize(4032, 3024, "2048"))).toEqual([2048, 1536]);
    expect(check(outputSize(1000, 1000, "1536"))).toEqual([1536, 1536]);
    expect(check(outputSize(1080, 1920, "1536"))).toEqual([864, 1536]);
  });
  it("clamps extreme panoramas to 3:1", () => {
    expect(check(outputSize(10000, 1000, "1536"))).toEqual([1536, 512]);
    expect(check(outputSize(500, 5000, "2048"))).toEqual([688, 2048]);
  });
  it("passes auto through", () => {
    expect(outputSize(100, 200, "auto")).toBe("auto");
    expect(outputSize(0, 0, "1536")).toBe("auto");
  });
});

describe("knete settings", () => {
  it("falls back to defaults for invalid values", () => {
    const s = normalizeKneteSettings({ model: "bad model!", quality: "ultra" as never, size: "999" as never, prompt: "  ", concurrency: 99 });
    expect(s.model).toBe("gpt-image-2.6-sunburst");
    expect(s.quality).toBe("high");
    expect(s.size).toBe("1536");
    expect(s.prompt).toContain("Image 1 is a photo");
    expect(s.concurrency).toBe(6);
  });
});

describe("knete names", () => {
  it("sanitizes file and folder names", () => {
    expect(safeBase("IMG_1234.HEIC")).toBe("IMG_1234");
    expect(safeBase("Urlaub 2026 (1).jpg")).toBe("Urlaub_2026_1");
    expect(safeBase("../../.jpg")).toBe("bild");
    expect(safeFolder(" Familie / Sommer ")).toBe("Familie_Sommer");
    expect(safeFolder("", new Date(2026, 10, 17, 9, 5))).toBe("2026-11-17_0905");
  });
});

describe("knete OpenAI errors", () => {
  it("classifies errors", () => {
    expect(describeOpenAIError(400, { error: { message: "Your request was rejected by the safety system.", code: "moderation_blocked" } })).toMatch(/Inhaltsfilter/);
    expect(isFatalOpenAIError(401, null)).toBe(true);
    expect(isFatalOpenAIError(429, { error: { code: "insufficient_quota" } })).toBe(true);
    expect(isRetryableStatus(429, { error: { code: "insufficient_quota" } })).toBe(false);
    expect(isRetryableStatus(429, { error: { code: "rate_limit_exceeded" } })).toBe(true);
    expect(isRetryableStatus(503, null)).toBe(true);
    expect(isRetryableStatus(400, null)).toBe(false);
  });
  it("computes cost from usage", () => {
    const c = costFromUsage({ input_tokens: 6200, input_tokens_details: { image_tokens: 6000, text_tokens: 200 }, output_tokens: 4200 });
    expect(c).toBeCloseTo((6000 * 8 + 200 * 5 + 4200 * 30) / 1e6, 6);
  });
});
