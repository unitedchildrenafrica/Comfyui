import { describe, expect, it } from "vitest";
import { builtinPresets } from "@/lib/defaults";
import { dedupeJobs, groupSets as groupLite, jobModels, remapJobModels, summarizeJob, type ModelLists } from "@/lib/restore";
import type { H3Settings, ImageSettings, JobRecord } from "@/lib/types";

const base = Object.values(builtinPresets())[0] as ImageSettings;
const img = (over: Partial<ImageSettings> = {}): ImageSettings => ({ ...base, generator: "wai", folder: "wai/lisa", ...over });

const groupSets = (js: JobRecord[], present: Set<string>, tz = 0) => groupLite(js.map(summarizeJob), present, tz);

let n = 0;
function job(over: Partial<JobRecord> & { settings?: ImageSettings | H3Settings } = {}): JobRecord {
  n++;
  return {
    promptId: `p${n}`,
    kind: "image",
    generator: "wai",
    settings: img(),
    prompt: { positive: `prompt ${n}`, negative: "neg", name: `bild_${n}` },
    seed: 1000 + n,
    label: `bild_${n}`,
    createdAt: Date.UTC(2026, 10, 24, 10, 0, n),
    ...over,
  };
}

describe("groupSets", () => {
  it("fasst Batches zusammen, Einzelbilder je Ordner und Tag, neueste zuerst", () => {
    const a1 = job({ batchId: "A", index: 0 });
    const a2 = job({ batchId: "A", index: 1 });
    const s1 = job({ settings: img({ folder: "pony" }), createdAt: Date.UTC(2026, 10, 24, 12) });
    const s2 = job({ settings: img({ folder: "pony" }), createdAt: Date.UTC(2026, 10, 24, 13) });
    const s3 = job({ settings: img({ folder: "pony" }), createdAt: Date.UTC(2026, 10, 25, 9) });
    const sets = groupSets([a2, s1, a1, s3, s2], new Set([a1.promptId]));
    expect(sets.map((s) => [s.folder, s.jobs])).toEqual([
      ["pony", 1],
      ["pony", 2],
      ["wai/lisa", 2],
    ]);
    const batch = sets[2];
    expect(batch.promptIds).toEqual([a1.promptId, a2.promptId]);
    expect(batch.present).toBe(1);
    expect(batch.names).toEqual([a1.label, a2.label]);
    // Modelle des Sets einmal, nicht pro Job
    expect(batch.needs.filter((m) => m.type === "checkpoint")).toHaveLength(1);
  });

  it("Tagesgrenze in der Zeitzone des Handys", () => {
    // 23:30 UTC = 00:30 in Berlin (Offset -60) → anderer Tag
    const x = job({ settings: img({ folder: "anima" }), createdAt: Date.UTC(2026, 10, 24, 22, 0) });
    const y = job({ settings: img({ folder: "anima" }), createdAt: Date.UTC(2026, 10, 24, 23, 30) });
    expect(groupSets([x, y], new Set(), 0)).toHaveLength(1);
    expect(groupSets([x, y], new Set(), -60)).toHaveLength(2);
  });

  it("neu gestartete Jobs zählen beim Original", () => {
    const o = job({ batchId: "B" });
    const r = job({ batchId: "C", restoredFrom: o.promptId });
    const sets = groupSets([o, r], new Set());
    expect(sets.find((s) => s.key === "b:B")!.restored).toBe(1);
    // die Kopie erscheint nicht als eigenes Set
    expect(sets.map((s) => s.key)).toEqual(["b:B"]);
    // ohne Original (Datei weg) aber schon
    expect(groupSets([r], new Set()).map((s) => s.key)).toEqual(["b:C"]);
  });
});

describe("jobModels", () => {
  it("WAI: Checkpoint, LoRAs (nur aktive), Upscaler – kein VAE bei automatic, kein Lanczos", () => {
    const j = job({
      settings: img({
        checkpoint: "wai_v17.safetensors",
        vae: "auto",
        loras: [
          { name: "a.safetensors", strength: 1, enabled: true },
          { name: "aus.safetensors", strength: 1, enabled: false },
        ],
        upscale: { ...base.upscale, enabled: true, upscaler: "4x_foolhardy_Remacri.pth" },
      }),
    });
    expect(jobModels(j).map((m) => `${m.type}:${m.name}`)).toEqual(["checkpoint:wai_v17.safetensors", "lora:a.safetensors", "upscaler:4x_foolhardy_Remacri.pth"]);
    const l = job({ settings: img({ upscale: { ...base.upscale, enabled: true, upscaler: "lanczos" }, loras: [] }) });
    expect(jobModels(l).map((m) => m.type)).toEqual(["checkpoint"]);
  });

  it("Anima: UNet, Text-Encoder, VAE", () => {
    const j = job({ generator: "anima", settings: img({ generator: "anima", unet: "u.safetensors", textEncoder: "t.safetensors", vae: "v.safetensors", loras: [], upscale: { ...base.upscale, enabled: false } }) });
    expect(jobModels(j).map((m) => `${m.type}:${m.name}`)).toEqual(["unet:u.safetensors", "text_encoder:t.safetensors", "vae:v.safetensors"]);
  });

  it("Krea 2: UNet, Text-Encoder, VAE wie Anima", () => {
    const j = job({ generator: "krea2", settings: img({ generator: "krea2", unet: "krea2.safetensors", textEncoder: "te.safetensors", vae: "ae.safetensors", loras: [], upscale: { ...base.upscale, enabled: false } }) });
    expect(jobModels(j).map((m) => `${m.type}:${m.name}`)).toEqual(["unet:krea2.safetensors", "text_encoder:te.safetensors", "vae:ae.safetensors"]);
  });

  it("Video: DiT, Text-Encoder, LoRAs auf dem Video-Pod", () => {
    const s = { ditModel: "h3.safetensors", textEncoder: "te.safetensors", loras: [{ name: "v.safetensors", strength: 1, enabled: true }, { name: "None", strength: 1, enabled: true }] } as H3Settings;
    const m = jobModels(job({ kind: "video", generator: "h3", settings: s }));
    expect(m.map((x) => `${x.role}:${x.type}:${x.name}`)).toEqual(["video:unet:h3.safetensors", "video:text_encoder:te.safetensors", "video:lora:v.safetensors"]);
  });
});

describe("remapJobModels", () => {
  const lists: ModelLists = {
    bild: { checkpoint: ["illustrious/wai_v17.safetensors"], lora: ["a.safetensors"], upscaler: [], vae: [] },
    video: {},
  };

  it("findet Modelle in anderem Unterordner und meldet fehlende", () => {
    const j = job({
      settings: img({
        checkpoint: "wai_v17.safetensors",
        loras: [
          { name: "sub/a.safetensors", strength: 0.8, enabled: true },
          { name: "weg.safetensors", strength: 1, enabled: true },
        ],
        upscale: { ...base.upscale, enabled: false },
      }),
    });
    const { settings, missing } = remapJobModels(j as JobRecord & { settings: ImageSettings }, lists);
    expect(settings.checkpoint).toBe("illustrious/wai_v17.safetensors");
    expect(settings.loras.map((l) => l.name)).toEqual(["a.safetensors", "weg.safetensors"]);
    expect(missing.map((m) => m.name)).toEqual(["weg.safetensors"]);
    // Original bleibt unverändert
    expect((j.settings as ImageSettings).checkpoint).toBe("wai_v17.safetensors");
  });

  it("unbekannte Listen (Pod offline) gelten nicht als fehlend", () => {
    const s = { ditModel: "h3.safetensors", textEncoder: "te.safetensors", loras: [] } as unknown as H3Settings;
    const { missing } = remapJobModels(job({ kind: "video", generator: "h3", settings: s }) as JobRecord & { settings: H3Settings }, lists);
    expect(missing).toEqual([]);
  });
});

describe("Jedes Bild nur einmal", () => {
  // derselbe 3er-Batch dreimal abgeschickt: A abgebrochen (nur 1 fertig), B komplett fertig, C neuester, nie gelaufen
  const run = (batchId: string, t: number) =>
    [0, 1, 2].map((i) => job({ batchId, index: i, label: `bild_${i}`, createdAt: t + i, prompt: { positive: `p${i}`, negative: "", name: `bild_${i}` } }));
  const A = run("A", 1000);
  const B = run("B", 2000);
  const C = run("C", 3000);
  const lites = [...A, ...B, ...C].map(summarizeJob);

  it("nimmt die Version, die damals fertig wurde", () => {
    const finished = new Set([A[0].promptId, ...B.map((j) => j.promptId)]);
    const keep = dedupeJobs(lites, finished);
    expect([...keep].sort()).toEqual(B.map((j) => j.promptId).sort());
  });

  it("ohne Wissen über „fertig“: die neueste", () => {
    expect([...dedupeJobs(lites, null)].sort()).toEqual(C.map((j) => j.promptId).sort());
  });

  it("andere Ordner und Einzelbilder bleiben getrennt", () => {
    const other = job({ batchId: "D", label: "bild_0", settings: img({ folder: "anderer" }) });
    const single1 = job({ label: "bild" });
    const single2 = job({ label: "bild" });
    const keep = dedupeJobs([...lites, other, single1, single2].map((j) => ("outputKey" in j ? j : summarizeJob(j))), null);
    expect(keep.has(other.promptId)).toBe(true);
    expect(keep.has(single1.promptId) && keep.has(single2.promptId)).toBe(true);
  });

  it("zählt fertig gewordene pro Set", () => {
    const finished = new Set([A[0].promptId, ...B.map((j) => j.promptId)]);
    const sets = groupLite(lites, new Set(), 0, finished);
    expect(sets.map((x) => [x.key, x.finished])).toEqual([
      ["b:C", 0],
      ["b:B", 3],
      ["b:A", 1],
    ]);
    expect(groupLite(lites, new Set(), 0, null)[0].finished).toBeNull();
  });
});
