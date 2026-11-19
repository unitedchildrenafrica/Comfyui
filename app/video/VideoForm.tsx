"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BellToggle } from "@/components/Alarm";
import { LoraList } from "@/components/LoraList";
import { PasteButton } from "@/components/PasteButton";
import { JobTracker, type Submitted } from "@/components/JobTracker";
import { ComfyDown, ErrorBox, Field, NodeErrors, NumberInput, Section, Segmented, Select, Slider, Toggle, WarnBox } from "@/components/ui";
import { useOptions } from "@/hooks/useOptions";
import { H3_MAX_LORAS, h3PromptText } from "@/lib/builders/h3";
import { api, ApiError, loadLocal, saveLocal } from "@/lib/client";
import { H3_RESOLUTIONS, defaultH3Settings } from "@/lib/defaults";
import { H3_BLOCK_LABELS, checkH3Prompt, emptyBlocks, nextClipName, parseH3Prompt, safeClipName, splitClipName } from "@/lib/h3prompt";
import { parseVideoBatch } from "@/lib/h3batch";
import { EXTRA_TAB, refTabName, refTabShort, refWarnings, tagWarnings } from "@/lib/h3refs";
import { H3_BLOCK_KEYS, type H3Ref, type H3Settings, type JobRecord } from "@/lib/types";
import { RefEditor, imageLimit } from "./RefEditor";
import { RefTabsBar, emptyTabs, useRefTabs } from "./RefTabs";
import { TabGroups } from "./TabGroups";

const STORAGE_KEY = "pf.video.v1";

export function VideoForm() {
  const params = useSearchParams();
  const { options, error: optError, reload } = useOptions();
  const [s, setS] = useState<H3Settings>(defaultH3Settings);
  const [loaded, setLoaded] = useState(false);
  const [lastSeed, setLastSeed] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ message: string; nodeErrors?: Record<string, unknown>; comfyDown?: boolean; batchErrors?: { block: number; message: string }[] } | null>(null);
  const [failedInfo, setFailedInfo] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [pasteInfo, setPasteInfo] = useState<string | null>(null);
  const [jobRefs, setJobRefs] = useState<H3Ref[] | null>(null);
  const [refNote, setRefNote] = useState<string | null>(null);
  const set = (patch: Partial<H3Settings>) => setS((x) => ({ ...x, ...patch }));
  const refTabs = useRefTabs();
  const tabs = refTabs.tabs;
  const extra = refTabs.extra;
  // 0 = Tab Extra (nur solange es ihn gibt), sonst 1…N
  const activeTab = s.refTab === EXTRA_TAB && extra ? EXTRA_TAB : tabs ? Math.min(Math.max(1, s.refTab ?? 1), tabs.length) : 1;
  // Bis die Tabs vom Server da sind, die zuletzt benutzten Refs zeigen
  const refs = tabs ? (activeTab === EXTRA_TAB ? (extra ?? []) : tabs[activeTab - 1]) : s.refs;

  useEffect(() => {
    const stored = loadLocal<{ s: H3Settings; lastSeed: number | null }>(STORAGE_KEY, { s: defaultH3Settings(), lastSeed: null });
    setS({ ...defaultH3Settings(), ...stored.s, blocks: { ...emptyBlocks(), ...stored.s?.blocks } });
    setLastSeed(stored.lastSeed);
    setLoaded(true);
    refTabs.init(stored.s?.refs ?? []);
    const from = params.get("from");
    if (from)
      api<{ job: JobRecord | null }>(`/api/jobs/${from}`)
        .then(({ job }) => {
          if (job?.kind !== "video") return;
          const js = job.settings as H3Settings;
          setS((cur) => ({ ...defaultH3Settings(), ...js, refTab: cur.refTab, seed: job.seed }));
          setJobRefs(js.refs ?? []);
        })
        .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loaded) saveLocal(STORAGE_KEY, { s: { ...s, refs }, lastSeed });
  }, [loaded, s, refs, lastSeed]);

  // Refs aus einem gespeicherten Job in einen passenden Tab legen, sobald die Tabs geladen sind
  useEffect(() => {
    if (!jobRefs || !tabs) return;
    // „Einstellungen übernehmen“: Refs des Videos immer in Tab Extra – Tab 1…N bleiben unberührt
    refTabs.setExtra(jobRefs);
    setJobRefs(null);
    set({ refTab: EXTRA_TAB });
    setRefNote(
      jobRefs.length
        ? `${jobRefs.length === 1 ? "Die Referenz" : `Die ${jobRefs.length} Referenzen`} des Videos ${jobRefs.length === 1 ? "liegt" : "liegen"} in „Tab Extra“ – deine Tabs 1–${tabs.length} sind unverändert.`
        : "Das Video hatte keine Referenzen – „Tab Extra“ ist leer.",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobRefs, tabs]);

  const isRef = s.mode === "REF2VA";
  const useBlocks = isRef && s.promptInput === "blocks";
  const isBatch = s.promptInput === "batch";
  const finalPrompt = isBatch ? "" : h3PromptText(s);

  const batch = useMemo(
    () => (isBatch ? parseVideoBatch(s.batchText ?? "", { mode: s.mode, noDialogue: s.noDialogue, tabs: tabs ?? undefined, extra, defaultTab: activeTab }) : null),
    [isBatch, s.batchText, s.mode, s.noDialogue, tabs, extra, activeTab],
  );
  const batchReady = !!batch && batch.items.length > 0 && !batch.errors.length;
  const batchSeconds = (batch?.items ?? []).map((it) => it.duration ?? s.duration);
  const batchLabel =
    batchSeconds.length && batchSeconds.some((x) => x !== batchSeconds[0])
      ? `Batch generieren – ${batchSeconds.length} Clips · ${batchSeconds.reduce((a, b) => a + b, 0)}s`
      : `Batch generieren – ${batchSeconds.length} Clips × ${batchSeconds[0] ?? s.duration}s`;
  const warnings = useMemo(() => {
    if (isBatch) return [];
    const missingTags = isRef ? tagWarnings(finalPrompt, refs) : [];
    return [
      ...(missingTags.length ? [`${missingTags.join(", ")} gibt es in ${refTabName(activeTab)} nicht`] : []),
      ...checkH3Prompt(finalPrompt, useBlocks ? s.blocks.overall_soundscape : finalPrompt, s.noDialogue),
    ];
  }, [isBatch, isRef, finalPrompt, refs, activeTab, useBlocks, s.blocks.overall_soundscape, s.noDialogue]);
  const modes = options?.h3.modes.length ? options.h3.modes : ["REF2VA", "FL2VA", "T2VA", "I2VA", "L2VA"];
  const missing = options?.h3.missingNodes ?? [];
  const resId = H3_RESOLUTIONS.findIndex((r) => r.width === s.width && r.height === s.height);
  const tooManyImages = !isBatch && refs.filter((r) => r.kind === "image").length > imageLimit(s.mode);

  const pasteFull = (raw: string) => {
    // Mehrere Prompts in der Zwischenablage (getrennt durch --- oder „Clip N“) → Batch
    const multi = parseVideoBatch(raw, { mode: s.mode, noDialogue: s.noDialogue });
    if (isBatch || multi.items.length + multi.errors.length >= 2) {
      set({ promptInput: "batch", batchText: raw });
      setPasteInfo(`${multi.items.length} Clips erkannt – Batch-Modus: jeder Clip wird ein eigener Job.`);
      return;
    }
    // Erste Zeile „Clip 35“ o. Ä. wird zum Dateinamen und nicht Teil des Prompts
    const { name, text } = splitClipName(raw);
    const named = name ? ` Clip-Name „${name}“ übernommen.` : " Keine Clip-Zeile oben – Dateiname nach Uhrzeit.";
    const blocks = parseH3Prompt(text);
    if (blocks) {
      set({ blocks, fullPrompt: text, promptInput: "blocks", clipName: name });
      setPasteInfo(`Blöcke erkannt und verteilt.${named}`);
    } else {
      set({ fullPrompt: text, promptInput: "full", clipName: name });
      setPasteInfo(isRef ? `Keine vollständigen Blöcke erkannt – Text steht unverändert unter „Kompletten Prompt einfügen“.${named}` : name ? named.trim() : null);
    }
  };
  /** Ganzer Prompt (evtl. mit Clip-Zeile) statt nur ein Block? */
  const isFullPrompt = (raw: string) => {
    if (parseVideoBatch(raw, { mode: s.mode, noDialogue: s.noDialogue }).items.length >= 2) return true;
    const { text } = splitClipName(raw);
    return !!parseH3Prompt(text) && (text.match(/^\s*[a-z_]+\s*:/gim)?.length ?? 0) >= 3;
  };
  const clipFile = safeClipName(s.clipName ?? "");
  const nextClip = nextClipName(s.clipName ?? "");

  const generate = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      setFailedInfo([]);
      const res = await api<{ promptIds: string[]; seeds: number[]; batchId?: string; failed?: { name: string; error: string }[] }>("/api/generate/video", {
        method: "POST",
        json: { settings: { ...s, refs, refTab: activeTab, refTabs: tabs ?? undefined, refExtra: extra } },
      });
      setSubmitted({ promptIds: res.promptIds, seeds: res.seeds, batchId: res.batchId, kind: "video" });
      if (res.seeds.length) setLastSeed(res.seeds[res.seeds.length - 1]);
      setFailedInfo((res.failed ?? []).map((f) => `${f.name}: ${f.error}`));
    } catch (err) {
      const e = err as ApiError;
      setSubmitError({
        message: e.message,
        nodeErrors: e.data?.node_errors as Record<string, unknown> | undefined,
        comfyDown: e.comfyDown,
        batchErrors: e.data?.batchErrors as { block: number; message: string }[] | undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const o = options;
  return (
    <main className="page">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-lg font-semibold">MiniMax H3</h1>
        <BellToggle />
      </div>
      {optError && (optError instanceof ApiError && optError.comfyDown ? <ComfyDown onRetry={reload} /> : <ErrorBox>{optError.message}</ErrorBox>)}
      {missing.length > 0 && <WarnBox>Auf dem Pod fehlen Nodes: {missing.join(", ")}. Video ist deaktiviert, bis ComfyUI-DaSiWa-Nodes installiert ist.</WarnBox>}

      <Section title="Grundeinstellungen" defaultOpen right={`${s.mode} · ${s.duration}s`}>
        <Field label="Modus">
          <Select value={s.mode} onChange={(v) => set({ mode: v })} options={modes} />
        </Field>
        <Field label="Dauer (Sekunden)" hint={isBatch ? "Im Batch: gilt für Clips ohne eigene Zeile „Dauer 8“." : undefined}>
          <Slider value={s.duration} min={2} max={15} step={1} onChange={(v) => set({ duration: v })} />
        </Field>
        <Field
          label="Auflösung"
          right={`${s.width}×${s.height}`}
          hint={resId === -1 && (s.width % 32 !== 0 || s.height % 32 !== 0) ? "H3 rechnet im 32-px-Raster – am besten Vielfache von 32." : "Native 768p wie in ComfyUI (kurze Seite 768 px)."}
        >
          <Segmented
            value={resId}
            options={[...H3_RESOLUTIONS.map((r, i) => ({ value: i, label: r.label })), { value: -1, label: "Custom" }]}
            onChange={(i) => (i >= 0 ? set({ width: H3_RESOLUTIONS[i].width, height: H3_RESOLUTIONS[i].height }) : set({ width: s.width + 32 }))}
          />
        </Field>
        {resId === -1 && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Breite">
              <NumberInput value={s.width} step={32} min={256} max={2048} onChange={(v) => set({ width: v ?? 1024 })} />
            </Field>
            <Field label="Höhe">
              <NumberInput value={s.height} step={32} min={256} max={2048} onChange={(v) => set({ height: v ?? 768 })} />
            </Field>
          </div>
        )}
        <Field label="Frame-Rate">
          <Slider value={s.frameRate} min={8} max={60} step={1} onChange={(v) => set({ frameRate: v })} />
        </Field>
      </Section>

      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold">Prompt</span>
          <button type="button" className="text-sm text-accent underline" onClick={() => setShowPreview(!showPreview)}>
            Prompt prüfen
          </button>
        </div>
        <PasteButton block label="📋 Prompt aus Zwischenablage einfügen (ersetzt alles)" onPaste={pasteFull} />
        {!isBatch && (
        <Field
          label="Clip-Name"
          hint={clipFile ? `Datei: ${clipFile}_00001.mp4 (beim nächsten Mal _00002 …)` : "Leer = Datei nach Uhrzeit. Steht über dem Prompt eine Zeile wie „Clip 35“, wird sie hier automatisch übernommen."}
        >
          <div className="flex gap-2">
            <input className="input flex-1" value={s.clipName ?? ""} onChange={(e) => set({ clipName: e.target.value })} placeholder="z. B. Clip 35" />
            {nextClip && (
              <button type="button" className="btn btn-ghost px-3 text-sm" onClick={() => set({ clipName: nextClip })} title={nextClip}>
                +1
              </button>
            )}
            {s.clipName && (
              <button type="button" className="btn btn-ghost px-3" aria-label="Clip-Name leeren" onClick={() => set({ clipName: "" })}>
                ✕
              </button>
            )}
          </div>
        </Field>
        )}
        <Segmented
          value={isBatch ? "batch" : isRef ? s.promptInput : "full"}
          options={[
            ...(isRef
              ? [
                  { value: "blocks" as const, label: "Blöcke" },
                  { value: "full" as const, label: "Kompletter Prompt" },
                ]
              : [{ value: "full" as const, label: "Einzeln" }]),
            { value: "batch" as const, label: "Batch" },
          ]}
          onChange={(v) =>
            set({
              promptInput: v,
              fullPrompt: v === "full" && !s.fullPrompt && s.promptInput === "blocks" ? h3PromptText({ ...s, promptInput: "blocks" }) : s.fullPrompt,
            })
          }
        />
        {isBatch ? (
          <div className="space-y-3">
            <Field
              label="Viele Prompts auf einmal"
              hint="Prompts mit einer Zeile „---“ trennen – oder einfach jeden mit „Clip 35“, „Clip 36“ … beginnen. Die Clip-Zeile wird zum Dateinamen. Darüber eine Zeile „Ref-Tab 3“ nimmt für diesen Clip die Referenzen aus Tab 3 (sonst der gewählte Tab), eine Zeile „Dauer 8“ macht ihn 8 s lang (sonst der Regler oben). Alle anderen Einstellungen und LoRAs gelten für alle Clips. Jeder Clip wird ein eigener Job und sofort in die Warteschlange gestellt – läuft auch bei gesperrtem Handy weiter."
            >
              <textarea
                className="input min-h-72 text-sm"
                value={s.batchText ?? ""}
                placeholder={"Ref-Tab 1\nClip 35\nDauer 8\nsubject_definitions:\n…\n\n---\n\nRef-Tab 3\nClip 36\nDauer 12\nsubject_definitions:\n…"}
                onChange={(e) => set({ batchText: e.target.value })}
              />
            </Field>
            {batch && (batch.items.length > 0 || batch.errors.length > 0) && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {batch.items.length} Clips erkannt{batch.errors.length ? ` · ${batch.errors.length} fehlerhaft` : ""}
                </p>
                {batch.errors.length > 0 && (
                  <ErrorBox>
                    <ul className="space-y-1">
                      {batch.errors.map((e, i) => (
                        <li key={i}>{e.block ? `Abschnitt ${e.block}: ` : ""}{e.message}</li>
                      ))}
                    </ul>
                  </ErrorBox>
                )}
                <ol className="space-y-1.5">
                  {batch.items.map((it, i) => (
                    <li key={i} className="rounded-xl border border-line bg-bg px-3 py-2 text-sm">
                      <p>
                        <span className="text-muted">{i + 1}.</span> <span className="font-medium">{it.name || "ohne Namen (Uhrzeit)"}</span>
                        {it.refTab !== null && isRef && (
                          <span className="ml-2 rounded-md bg-card px-1.5 py-0.5 text-xs text-soft">
                            {refTabShort(it.refTab)} · {it.refs?.length ?? 0} Refs
                          </span>
                        )}
                        <span className={`ml-2 rounded-md bg-card px-1.5 py-0.5 text-xs ${it.duration !== null ? "text-accent" : "text-muted"}`}>
                          {it.duration ?? s.duration} s
                        </span>
                      </p>
                      {it.preview && <p className="truncate text-xs text-muted">{it.preview}</p>}
                      {it.warnings.map((w) => (
                        <p key={w} className="text-xs text-amber-200">
                          ⚠ {w}
                        </p>
                      ))}
                    </li>
                  ))}
                </ol>
                {batch.skipped.length > 0 && <p className="text-xs text-muted">Übersprungen (kein Prompt): {batch.skipped.map((x) => `„${x}“`).join(", ")}</p>}
              </div>
            )}
          </div>
        ) : useBlocks ? (
          H3_BLOCK_KEYS.map((key) => (
            <Field
              key={key}
              label={H3_BLOCK_LABELS[key]}
              right={
                <PasteButton
                  label="📋"
                  onPaste={(t) =>
                    // Ganzer Prompt in der Zwischenablage → auf alle Blöcke verteilen, sonst nur diesen Block ersetzen
                    isFullPrompt(t) ? pasteFull(t) : set({ blocks: { ...s.blocks, [key]: t } })
                  }
                />
              }
            >
              <textarea
                className={`input ${key === "detailed_description" ? "min-h-48" : "min-h-20"}`}
                value={s.blocks[key]}
                onChange={(e) => set({ blocks: { ...s.blocks, [key]: e.target.value } })}
                onPaste={(e) => {
                  // Ganzen Prompt in ein Feld eingefügt? → automatisch verteilen
                  const text = e.clipboardData.getData("text");
                  if (isFullPrompt(text)) {
                    e.preventDefault();
                    pasteFull(text);
                  }
                }}
              />
            </Field>
          ))
        ) : (
          <Field label={isRef ? "Kompletter Prompt" : "Prompt"} hint={isRef ? "Beim Einfügen werden die Blöcke erkannt und in die Einzelfelder verteilt." : undefined}>
            <textarea
              className="input min-h-72 text-sm"
              value={s.fullPrompt}
              onChange={(e) => set({ fullPrompt: e.target.value })}
              onPaste={(e) => {
                const el = e.currentTarget;
                const replacesAll = !el.value || (el.selectionStart === 0 && el.selectionEnd === el.value.length);
                if (isRef && replacesAll) {
                  e.preventDefault();
                  pasteFull(e.clipboardData.getData("text"));
                }
              }}
            />
          </Field>
        )}
        {isRef && !useBlocks && !isBatch && (
          <button type="button" className="btn btn-ghost w-full" onClick={() => pasteFull(s.fullPrompt)}>
            In Blöcke verteilen
          </button>
        )}
        {pasteInfo && <p className="text-xs text-muted">{pasteInfo}</p>}
        <Toggle checked={s.noDialogue} onChange={(v) => set({ noDialogue: v })} label="Kein Dialog" />
        {warnings.length > 0 && (
          <WarnBox>
            <ul className="space-y-1">
              {warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          </WarnBox>
        )}
        {showPreview && !isBatch && <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-bg p-3 text-xs">{finalPrompt || "(leer)"}</pre>}
      </section>

      <Section title="Referenzen" defaultOpen={refs.length > 0 || (tabs?.some((t) => t.length) ?? false)} right={`${refTabShort(activeTab)} · ${refs.length}`}>
        {tabs && (
          <TabGroups
            tabs={tabs}
            group={refTabs.group}
            extraCount={extra?.length ?? 0}
            onSaved={(name) => refTabs.setGroupName(name)}
            onClearAll={() => {
              refTabs.replaceAll(emptyTabs(), null);
              refTabs.closeExtra();
              set({ refTab: 1 });
              setRefNote(null);
            }}
            onLoad={(groupTabs, name) => {
              refTabs.replaceAll(groupTabs.length ? groupTabs : emptyTabs(), name);
              if (activeTab !== EXTRA_TAB) set({ refTab: 1 });
              setRefNote(null);
            }}
          />
        )}
        {tabs && (
          <RefTabsBar
            tabs={tabs}
            extra={extra}
            active={activeTab}
            onSelect={(tab) => {
              set({ refTab: tab });
              setRefNote(null);
            }}
            onAdd={() => {
              const tab = refTabs.addTab();
              if (tab) set({ refTab: tab });
            }}
            onCopy={(to) => {
              const tab = refTabs.copyTab(activeTab, to);
              if (!tab) return;
              setRefNote(`${refTabShort(activeTab)} nach Tab ${tab} kopiert – jetzt bearbeitest du Tab ${tab}.`);
              set({ refTab: tab });
            }}
            onCloseExtra={() => {
              refTabs.closeExtra();
              if (activeTab === EXTRA_TAB) set({ refTab: 1 });
              setRefNote(null);
            }}
          />
        )}
        {refTabs.error && <ErrorBox>{refTabs.error}</ErrorBox>}
        {refNote && <p className="text-xs text-muted">{refNote}</p>}
        {/* key: beim Tab-Wechsel Upload-Zustand des Editors zurücksetzen */}
        <RefEditor key={activeTab} mode={s.mode} refs={refs} onChange={(r) => (tabs ? refTabs.update(activeTab, r) : set({ refs: r }))} />
      </Section>

      <Section title="Modelle">
        <Field label="DiT-Modell">
          <Select value={s.ditModel} onChange={(v) => set({ ditModel: v })} options={o?.unets ?? []} />
        </Field>
        <Field label="Text-Encoder">
          <Select value={s.textEncoder} onChange={(v) => set({ textEncoder: v })} options={o?.clips ?? []} />
        </Field>
        <Field label="LoRAs">
          <LoraList loras={s.loras} onChange={(loras) => set({ loras })} available={o?.loras ?? []} target="video" use={o?.loraUse} max={H3_MAX_LORAS} onReload={reload} />
        </Field>
      </Section>

      <Section title="Sampling">
        <Field label="Steps">
          <Slider value={s.steps} min={1} max={40} onChange={(v) => set({ steps: v })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Sampler">
            <Select value={s.sampler} onChange={(v) => set({ sampler: v })} options={o?.h3.samplers ?? []} />
          </Field>
          <Field label="Scheduler">
            <Select value={s.scheduler} onChange={(v) => set({ scheduler: v })} options={o?.h3.schedulers ?? []} />
          </Field>
        </div>
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
      </Section>

      <Section title="Ausgabe">
        <Toggle
          checked={s.interpolation}
          onChange={(v) => set({ interpolation: v })}
          label="Frame-Interpolation (RIFE ×2)"
          disabled={o ? !o.h3.interpolationAvailable : false}
        />
        <Toggle checked={s.livePreview} onChange={(v) => set({ livePreview: v })} label="Live-Vorschau" disabled={o ? !o.h3.livePreviewAvailable : false} />
        <Field
          label="Format"
          hint={s.videoCodec === "Auto" ? "AV1 ist kleiner, lässt sich am iPhone aber nicht in „Fotos“ sichern." : "H.264 – läuft überall und lässt sich am iPhone in „Fotos“ sichern."}
        >
          <Segmented
            value={s.videoCodec ?? "H.264"}
            options={[
              { value: "H.264", label: "iPhone (H.264)" },
              { value: "Auto", label: "Auto (AV1)" },
            ]}
            onChange={(v) => set({ videoCodec: v })}
          />
        </Field>
        <Field label="Video-Qualität (CRF, kleiner = besser)">
          <Slider value={s.quality} min={10} max={40} onChange={(v) => set({ quality: v })} />
        </Field>
      </Section>

      {s.mode === "REF2VA" && !isBatch && refWarnings(refs).length > 0 && (
        <WarnBox>Referenzen in {refTabShort(activeTab)} prüfen (sonst bricht der Job ab): {refWarnings(refs).join(" ")}</WarnBox>
      )}
      {submitError && (
        <ErrorBox focus>
          {submitError.comfyDown ? "ComfyUI antwortet nicht – bitte gleich nochmal versuchen." : submitError.message}
          {submitError.nodeErrors && <NodeErrors errors={submitError.nodeErrors} />}
          {submitError.batchErrors && (
            <ul className="mt-2 space-y-1 text-xs">
              {submitError.batchErrors.map((e, i) => (
                <li key={i}>{e.block ? `Abschnitt ${e.block}: ` : ""}{e.message}</li>
              ))}
            </ul>
          )}
        </ErrorBox>
      )}
      {failedInfo.length > 0 && (
        <WarnBox>
          Nicht eingereiht: {failedInfo.join(" · ")}
        </WarnBox>
      )}
      {submitted && <JobTracker submitted={submitted} onUseSeed={(seed) => set({ seed })} onAgain={generate} />}

      <div className="sticky-action">
        <button
          type="button"
          className="btn btn-primary h-14 w-full text-lg shadow-lg shadow-black/40"
          disabled={submitting || (isBatch ? !batchReady : !finalPrompt) || missing.length > 0 || tooManyImages}
          onClick={generate}
        >
          {submitting
            ? "Wird eingereiht …"
            : isBatch
              ? batchLabel
              : `Video generieren – ${s.duration}s`}
        </button>
      </div>
    </main>
  );
}
