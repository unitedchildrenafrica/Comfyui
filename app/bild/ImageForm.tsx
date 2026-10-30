"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LoraList } from "@/components/LoraList";
import { PasteButton } from "@/components/PasteButton";
import { JobTracker, type Submitted } from "@/components/JobTracker";
import { ComfyDown, ErrorBox, Field, NodeErrors, NumberInput, Section, Segmented, Select, Slider, Toggle, WarnBox } from "@/components/ui";
import { useOptions } from "@/hooks/useOptions";
import { parseBatch, type BatchError } from "@/lib/batch";
import { scaledSize } from "@/lib/builders/common";
import { APPLY_EVENT, takePendingCharacter } from "@/lib/characterTools";
import { api, ApiError, IMAGE_FORM_KEY, loadLocal, saveLocal } from "@/lib/client";
import { ASPECTS, DEFAULT_NEGATIVE, UPSCALE_FACTORS, defaultImageSettings } from "@/lib/defaults";
import { type Character, findAvailable } from "@/lib/notes";
import type { ImageGenerator, ImageSettings, JobRecord } from "@/lib/types";

const GENERATORS: { value: ImageGenerator; label: string }[] = [
  { value: "wai", label: "WAI" },
  { value: "pony", label: "Pony" },
  { value: "anima", label: "Anima" },
];

type AllSettings = Record<ImageGenerator, ImageSettings>;
type Presets = Record<string, ImageSettings>;

const STORAGE_KEY = IMAGE_FORM_KEY;

function initialAll(): AllSettings {
  return { wai: defaultImageSettings("wai"), pony: defaultImageSettings("pony"), anima: defaultImageSettings("anima") };
}

export function ImageForm() {
  const params = useSearchParams();
  const { options, error: optError, reload } = useOptions();
  const [generator, setGenerator] = useState<ImageGenerator>("wai");
  const [all, setAll] = useState<AllSettings>(initialAll);
  const [loaded, setLoaded] = useState(false);
  const [presets, setPresets] = useState<Presets>({});
  const [appDefaults, setAppDefaults] = useState<{ folders: Record<ImageGenerator, string>; defaultNegative: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ message: string; nodeErrors?: Record<string, unknown>; batchErrors?: BatchError[]; comfyDown?: boolean } | null>(null);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [lastSeed, setLastSeed] = useState<number | null>(null);
  const [failedInfo, setFailedInfo] = useState<string[]>([]);

  const s = all[generator];
  const set = (patch: Partial<ImageSettings>) => setAll((a) => ({ ...a, [generator]: { ...a[generator], ...patch } }));
  const setUp = (patch: Partial<ImageSettings["upscale"]>) => set({ upscale: { ...s.upscale, ...patch } });

  // Gespeicherten Stand laden, ggf. Einstellungen aus der Galerie übernehmen
  useEffect(() => {
    const stored = loadLocal<{ generator: ImageGenerator; all: AllSettings; lastSeed: number | null }>(STORAGE_KEY, {
      generator: "wai",
      all: initialAll(),
      lastSeed: null,
    });
    const merged = initialAll();
    for (const g of Object.keys(merged) as ImageGenerator[]) merged[g] = { ...merged[g], ...stored.all?.[g] };
    setAll(merged);
    setGenerator(stored.generator ?? "wai");
    setLastSeed(stored.lastSeed ?? null);
    setLoaded(true);

    const from = params.get("from");
    if (from) {
      api<{ job: JobRecord | null }>(`/api/jobs/${from}`)
        .then(({ job }) => {
          if (!job || job.kind !== "image") return;
          const g = job.generator as ImageGenerator;
          const restored: ImageSettings = {
            ...defaultImageSettings(g),
            ...(job.settings as ImageSettings),
            promptMode: "single",
            positive: job.prompt?.positive ?? "",
            negative: job.prompt?.negative ?? "",
            seed: job.seed,
          };
          setGenerator(g);
          setAll((a) => ({ ...a, [g]: restored }));
        })
        .catch(() => {});
    }
    api<Presets>("/api/presets").then(setPresets).catch(() => {});
    api<typeof appDefaults>("/api/app-settings").then(setAppDefaults).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Charakter aus der Bibliothek übernehmen (Notizen → „Ins Bild-Formular“)
  const [charNotice, setCharNotice] = useState<string | null>(null);
  const loraOptions = useRef<string[]>([]);
  loraOptions.current = options?.loras ?? [];
  useEffect(() => {
    if (!loaded) return;
    const apply = (c: Character | null) => {
      if (!c) return;
      const g = c.generator;
      setGenerator(g);
      setAll((a) => ({
        ...a,
        [g]: {
          ...a[g],
          promptMode: "single",
          positive: c.positive || a[g].positive,
          negative: c.negative || a[g].negative,
          ...(c.checkpoint && g !== "anima" ? { checkpoint: c.checkpoint } : {}),
          // Ohne LoRAs im Charakter bleiben die bisherigen stehen
          ...(c.loras.length
            ? { loras: c.loras.map((l) => ({ name: findAvailable(l.name, loraOptions.current) ?? l.name, strength: l.strength, enabled: true })) }
            : {}),
        },
      }));
      setCharNotice(`„${c.name}“ übernommen`);
      setTimeout(() => setCharNotice(null), 4000);
    };
    apply(takePendingCharacter());
    const onApply = () => apply(takePendingCharacter());
    window.addEventListener(APPLY_EVENT, onApply);
    return () => window.removeEventListener(APPLY_EVENT, onApply);
  }, [loaded]);

  useEffect(() => {
    if (loaded) saveLocal(STORAGE_KEY, { generator, all, lastSeed });
  }, [loaded, generator, all, lastSeed]);

  const defaultNegative = appDefaults?.defaultNegative ?? DEFAULT_NEGATIVE;
  const batch = useMemo(() => (s.promptMode === "batch" ? parseBatch(s.batchText, s.negative.trim() || defaultNegative) : null), [s.promptMode, s.batchText, s.negative, defaultNegative]);
  const jobCount = s.promptMode === "batch" ? (batch?.items.length ?? 0) : s.positive.trim() ? 1 : 0;
  const imageCount = jobCount * s.batchSize;
  const isAnima = generator === "anima";
  const aspect = ASPECTS.find((a) => a.width === s.width && a.height === s.height)?.id ?? "custom";
  const target = scaledSize(s.width, s.height, s.upscale.factor);
  const presetNames = Object.keys(presets).filter((n) => (isAnima ? presets[n].generator === "anima" : presets[n].generator !== "anima"));

  const applyPreset = (name: string) => {
    const p = presets[name];
    if (!p) return;
    const g = p.generator;
    setGenerator(g);
    setAll((a) => ({
      ...a,
      [g]: { ...defaultImageSettings(g), ...p, promptMode: a[g].promptMode, positive: a[g].positive || p.positive, negative: a[g].negative || p.negative, batchText: a[g].batchText },
    }));
  };

  const savePreset = async () => {
    const name = window.prompt("Name des Presets", "");
    if (!name) return;
    setPresets(await api<Presets>("/api/presets", { method: "POST", json: { name, settings: s } }));
  };

  const generate = async () => {
    setSubmitting(true);
    setSubmitError(null);
    setFailedInfo([]);
    try {
      const res = await api<{ batchId: string; promptIds: string[]; seeds: number[]; failed: { name: string; error: string }[] }>("/api/generate/image", {
        method: "POST",
        json: { settings: s },
      });
      setSubmitted({ promptIds: res.promptIds, seeds: res.seeds, batchId: res.batchId, kind: "image" });
      if (res.seeds.length) setLastSeed(res.seeds[res.seeds.length - 1]);
      setFailedInfo(res.failed.map((f) => `${f.name}: ${f.error}`));
    } catch (err) {
      const e = err as ApiError;
      setSubmitError({
        message: e.message,
        nodeErrors: e.data?.node_errors as Record<string, unknown> | undefined,
        batchErrors: e.data?.batchErrors as BatchError[] | undefined,
        comfyDown: e.comfyDown,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const o = options;
  const samplerOpts = o?.samplers ?? [];
  const schedulerOpts = o?.schedulers ?? [];

  return (
    <main className="page">
      <Segmented value={generator} options={GENERATORS} onChange={setGenerator} />
      {charNotice && <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">✓ Charakter {charNotice}</p>}

      {optError && (optError instanceof ApiError && optError.comfyDown ? <ComfyDown onRetry={reload} /> : <ErrorBox>{optError.message}</ErrorBox>)}

      <div className="flex gap-2">
        <div className="flex-1">
          <Select value="" onChange={applyPreset} options={presetNames} placeholder="Preset laden …" />
        </div>
        <button type="button" className="btn btn-ghost" onClick={savePreset}>
          Speichern
        </button>
      </div>

      <section className="card space-y-3 p-4">
        <Segmented
          value={s.promptMode}
          options={[
            { value: "single", label: "Einzeln" },
            { value: "batch", label: "Batch" },
          ]}
          onChange={(v) => set({ promptMode: v })}
        />
        {s.promptMode === "single" ? (
          <>
            <Field label="Positiv" right={<PasteButton onPaste={(t) => set({ positive: t })} />}>
              <textarea className="input min-h-32" value={s.positive} onChange={(e) => set({ positive: e.target.value })} placeholder="1girl, solo, …" />
            </Field>
            <Field label="Negativ" right={<PasteButton onPaste={(t) => set({ negative: t })} />}>
              <textarea className="input min-h-20" value={s.negative} onChange={(e) => set({ negative: e.target.value })} placeholder={defaultNegative} />
            </Field>
          </>
        ) : (
          <>
            <Field
              label="Batch-Prompts"
              hint="Blöcke mit --- trennen. Zeilen: positive: / negative: / name:"
              right={<PasteButton onPaste={(t) => set({ batchText: t })} />}
            >
              <textarea
                className="input min-h-72 font-mono text-sm"
                value={s.batchText}
                onChange={(e) => set({ batchText: e.target.value })}
                placeholder={"positive: 1girl, solo, silver hair\nnegative: lowres, bad anatomy\nname: bild_001\n---\npositive: …"}
              />
            </Field>
            <Field label="Standard-Negativ (wenn ein Block keins hat)">
              <textarea className="input min-h-16" value={s.negative} onChange={(e) => set({ negative: e.target.value })} placeholder={defaultNegative} />
            </Field>
            {batch && (
              <p className="text-sm text-muted">
                {batch.items.length} gültige Blöcke{batch.errors.length ? `, ${batch.errors.length} fehlerhaft` : ""}
              </p>
            )}
            {batch && batch.errors.length > 0 && (
              <ErrorBox>
                <ul className="space-y-1">
                  {batch.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>
                      Block {e.block}: {e.message}
                    </li>
                  ))}
                </ul>
              </ErrorBox>
            )}
          </>
        )}
      </section>

      <Section title="Modelle" defaultOpen>
        {isAnima ? (
          <>
            <Field label="UNet">
              <Select value={s.unet} onChange={(v) => set({ unet: v })} options={o?.unets ?? []} />
            </Field>
            <Field label="Text-Encoder">
              <Select value={s.textEncoder} onChange={(v) => set({ textEncoder: v })} options={o?.clips ?? []} />
            </Field>
            <Field label="VAE">
              <Select value={s.vae} onChange={(v) => set({ vae: v })} options={o?.vaes ?? []} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Grundmodell">
              <Select value={s.checkpoint} onChange={(v) => set({ checkpoint: v })} options={o?.checkpoints ?? []} />
            </Field>
            <Field label="VAE">
              <Select value={s.vae} onChange={(v) => set({ vae: v })} options={[{ value: "auto", label: "Automatic" }, ...(o?.vaes ?? [])]} />
            </Field>
          </>
        )}
        <Field label="LoRAs" hint={isAnima ? "Illustrious-/SDXL-LoRAs funktionieren nicht mit Anima." : undefined}>
          <LoraList loras={s.loras} onChange={(loras) => set({ loras })} available={o?.loras ?? []} target="image" use={o?.loraUse} />
        </Field>
      </Section>

      <Section title="Einstellungen" defaultOpen>
        <Field label="Seitenverhältnis" right={`${s.width}×${s.height}`}>
          <Segmented
            value={aspect}
            options={[...ASPECTS.map((a) => ({ value: a.id as string, label: a.label })), { value: "custom", label: "Custom" }]}
            onChange={(id) => {
              const a = ASPECTS.find((x) => x.id === id);
              if (a) set({ width: a.width, height: a.height });
              else set({ width: s.width + 64 });
            }}
          />
        </Field>
        {aspect === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Breite">
              <NumberInput value={s.width} step={64} min={256} max={2048} onChange={(v) => set({ width: v ?? 768 })} />
            </Field>
            <Field label="Höhe">
              <NumberInput value={s.height} step={64} min={256} max={2048} onChange={(v) => set({ height: v ?? 1152 })} />
            </Field>
            {(s.width % 64 !== 0 || s.height % 64 !== 0) && <p className="col-span-2 text-xs text-amber-300">Breite/Höhe sollten Vielfache von 64 sein.</p>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Sampler">
            <Select value={s.sampler} onChange={(v) => set({ sampler: v })} options={samplerOpts} />
          </Field>
          <Field label="Planer">
            <Select value={s.scheduler} onChange={(v) => set({ scheduler: v })} options={schedulerOpts} />
          </Field>
        </div>
        <Field label="Sampling-Schritte">
          <Slider value={s.steps} min={1} max={60} onChange={(v) => set({ steps: v })} />
        </Field>
        <Field label="CFG">
          <Slider value={s.cfg} min={1} max={15} step={0.5} onChange={(v) => set({ cfg: v })} />
        </Field>
        <Field
          label="Seed"
          hint="Leer = Zufall"
          right={
            lastSeed !== null && (
              <button type="button" className="text-accent underline" onClick={() => set({ seed: lastSeed })}>
                letzten Seed verwenden
              </button>
            )
          }
        >
          <NumberInput value={s.seed} min={0} placeholder="Zufall" onChange={(v) => set({ seed: v })} />
        </Field>
        <Field label="Anzahl Bilder pro Prompt">
          <Segmented value={s.batchSize} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} onChange={(v) => set({ batchSize: v })} />
        </Field>
      </Section>

      <Section title="Erweiterte Einstellungen">
        {!isAnima && (
          <Field label="Clip Skip">
            <Segmented value={s.clipSkip} options={[1, 2].map((n) => ({ value: n, label: String(n) }))} onChange={(v) => set({ clipSkip: v })} />
          </Field>
        )}
        {isAnima && (
          <>
            <Toggle
              checked={s.shiftEnabled}
              onChange={(v) => set({ shiftEnabled: v })}
              label="Sampling Shift"
              disabled={o ? !o.available.shiftNode : false}
              hint={o?.available.shiftNode ? `Node: ${o.available.shiftNode}` : o ? "Keine Shift-Node auf dem Pod gefunden" : undefined}
            />
            {s.shiftEnabled && (
              <Field label="Shift">
                <Slider value={s.shift} min={0} max={10} step={0.1} onChange={(v) => set({ shift: v })} />
              </Field>
            )}
          </>
        )}
        <Toggle
          checked={false}
          onChange={() => {}}
          label="ADetailer"
          disabled
          hint={o && !o.available.faceDetailer ? "Impact Pack (FaceDetailer) nicht installiert." : "Kommt in Phase 2."}
        />
        <Field label="Ausgabeordner">
          <input className="input" value={s.folder} placeholder={appDefaults?.folders[generator] ?? generator} onChange={(e) => set({ folder: e.target.value })} />
        </Field>
      </Section>

      <Section title="Hochskalieren" right={s.upscale.enabled ? `${s.upscale.factor}x` : "aus"}>
        <Toggle checked={s.upscale.enabled} onChange={(v) => setUp({ enabled: v })} label="Hochskalieren" />
        {s.upscale.enabled && (
          <>
            <Field label="Faktor" hint={`von ${s.width}×${s.height} auf ${target.width}×${target.height}`}>
              <Segmented
                value={(UPSCALE_FACTORS as readonly number[]).includes(s.upscale.factor) ? s.upscale.factor : -1}
                options={[...UPSCALE_FACTORS.map((f) => ({ value: f as number, label: `${f}x` })), { value: -1, label: "Custom" }]}
                onChange={(v) => setUp({ factor: v === -1 ? 1.25 : v })}
              />
            </Field>
            {!(UPSCALE_FACTORS as readonly number[]).includes(s.upscale.factor) && (
              <Slider value={s.upscale.factor} min={1} max={4} step={0.05} onChange={(v) => setUp({ factor: v })} />
            )}
            <Field label="Hochskalierer">
              <Select value={s.upscale.upscaler} onChange={(v) => setUp({ upscaler: v })} options={[{ value: "lanczos", label: "Lanczos (ohne Modell)" }, ...(o?.upscalers ?? [])]} />
            </Field>
            <Field label="Hires-Schritte">
              <Slider value={s.upscale.steps} min={1} max={50} onChange={(v) => setUp({ steps: v })} />
            </Field>
            <Field label="Denoising Strength">
              <Slider value={s.upscale.denoise} min={0} max={1} step={0.01} onChange={(v) => setUp({ denoise: v })} />
            </Field>
          </>
        )}
      </Section>

      {submitError && (
        <ErrorBox>
          {submitError.comfyDown ? "ComfyUI antwortet nicht – bitte gleich nochmal versuchen." : submitError.message}
          {submitError.batchErrors && (
            <ul className="mt-2 space-y-1">
              {submitError.batchErrors.map((e, i) => (
                <li key={i}>{e.block ? `Block ${e.block}: ` : ""}{e.message}</li>
              ))}
            </ul>
          )}
          {submitError.nodeErrors && <NodeErrors errors={submitError.nodeErrors} />}
        </ErrorBox>
      )}
      {failedInfo.length > 0 && (
        <WarnBox>
          {failedInfo.length} Jobs konnten nicht eingereiht werden:
          <ul className="mt-1 text-xs">
            {failedInfo.slice(0, 10).map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </WarnBox>
      )}
      {submitted && (
        <JobTracker
          submitted={submitted}
          onUseSeed={(seed) => set({ seed })}
          onAgain={generate}
        />
      )}

      <div className="sticky-action">
        <button type="button" className="btn btn-primary h-14 w-full text-lg shadow-lg shadow-black/40" disabled={submitting || jobCount === 0 || (batch?.errors.length ?? 0) > 0} onClick={generate}>
          {submitting ? "Wird eingereiht …" : `Generieren – ${imageCount} ${imageCount === 1 ? "Bild" : "Bilder"}`}
        </button>
      </div>
    </main>
  );
}

