import { describe, expect, it } from "vitest";
import { formatDuration } from "@/lib/format";
import { parseHistory } from "@/lib/server/history";

describe("formatDuration", () => {
  it("formatiert", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(75_000)).toBe("1:15");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatDuration(null)).toBe("–");
  });
});

describe("parseHistory", () => {
  it("Dauer aus den Zeitstempeln und Video aus gifs", () => {
    const [e] = parseHistory({
      abc: {
        outputs: { "2568": { gifs: [{ filename: "clip.mp4", subfolder: "video/x", type: "output" }] } },
        status: {
          status_str: "success",
          completed: true,
          messages: [
            ["execution_start", { prompt_id: "abc", timestamp: 1000 }],
            ["execution_cached", { nodes: [], timestamp: 1001 }],
            ["execution_success", { prompt_id: "abc", timestamp: 223_000 }],
          ],
        },
      },
    });
    expect(e.durationMs).toBe(222_000);
    expect(e.files).toEqual([{ filename: "clip.mp4", subfolder: "video/x", type: "output", kind: "video" }]);
  });

  it("ohne Zeitstempel → null", () => {
    const [e] = parseHistory({ x: { outputs: {}, status: { status_str: "success", messages: [] } } });
    expect(e.durationMs).toBeNull();
  });
});

import { resolveOutputFile } from "@/lib/server/zip";

describe("resolveOutputFile", () => {
  it("nur Mediendateien im Ausgabeordner", () => {
    process.env.OUTPUT_DIR = "/out";
    expect(resolveOutputFile("video/2026-10-29", "clip_1.mp4")).toBe("/out/video/2026-10-29/clip_1.mp4");
    expect(resolveOutputFile("", "bild_00001_.png")).toBe("/out/bild_00001_.png");
    expect(resolveOutputFile("../etc", "x.png")).toBeNull();
    expect(resolveOutputFile("wai", "../x.png")).toBeNull();
    expect(resolveOutputFile("wai", "passwd")).toBeNull();
    expect(resolveOutputFile("wai", ".hidden.png")).toBeNull();
  });
});

describe("parseHistory: selbst gestoppt", () => {
  it("execution_interrupted → interrupted statt error", () => {
    const [e] = parseHistory({
      x: {
        outputs: {},
        status: {
          status_str: "error",
          completed: false,
          messages: [
            ["execution_start", { timestamp: 1 }],
            ["execution_interrupted", { timestamp: 2 }],
          ],
        },
      },
    });
    expect(e.status).toBe("interrupted");
  });
});
