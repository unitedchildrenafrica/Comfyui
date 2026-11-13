import type { ImageSettings } from "../types";
import { type ApiWorkflow, node } from "./common";

// ADetailer (Impact Pack „FaceDetailer“ + Impact Subpack „UltralyticsDetectorProvider“):
// findet Gesichter bzw. Hände im fertigen Bild, rechnet die Stellen in hoher Auflösung neu und
// setzt sie wieder ein. Hängt sich direkt vor das Speichern (Node 15).

/** Eingangs-Beschreibung aus /object_info (input.required) */
export type InputSpec = Record<string, unknown[]>;

export interface DetailerOptions {
  /** FaceDetailer-Eingänge vom Pod – daraus kommen die Standardwerte (Versionen unterscheiden sich) */
  spec?: InputSpec | null;
  /** z. B. „bbox/face_yolov8m.pt“ */
  faceModel?: string | null;
  /** z. B. „bbox/hand_yolov8s.pt“ */
  handModel?: string | null;
}

// Stand Impact Pack (modules/impact/impact_pack.py) – nur genutzt, wenn der Pod nichts meldet
const FALLBACK: Record<string, unknown> = {
  guide_size: 512,
  guide_size_for: true,
  max_size: 1024,
  steps: 20,
  cfg: 8,
  denoise: 0.5,
  feather: 5,
  noise_mask: true,
  force_inpaint: true,
  bbox_threshold: 0.5,
  bbox_dilation: 10,
  bbox_crop_factor: 3,
  sam_detection_hint: "center-1",
  sam_dilation: 0,
  sam_threshold: 0.93,
  sam_bbox_expansion: 0,
  sam_mask_hint_threshold: 0.7,
  sam_mask_hint_use_negative: "False",
  drop_size: 10,
  wildcard: "",
  cycle: 1,
};

/** Standardwerte aus der Spezifikation: Liste → erster Eintrag, sonst „default“. Links (MODEL …) zählen nicht. */
export function defaultsFromSpec(spec: InputSpec | null | undefined): Record<string, unknown> {
  if (!spec) return { ...FALLBACK };
  const out: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(spec)) {
    if (!Array.isArray(def) || !def.length) continue;
    const [type, extra] = def as [unknown, Record<string, unknown> | undefined];
    if (Array.isArray(type)) out[name] = type[0];
    else if (extra && "default" in extra) out[name] = extra.default;
    else if (type === "STRING") out[name] = "";
  }
  return out;
}

export function adetailerWanted(s: ImageSettings) {
  return !!(s.adetailer || s.adetailerHands);
}

/** Gesichts- und/oder Hand-Detailer vor das Speichern hängen (wenn eingeschaltet). */
export function applyDetailers(wf: ApiWorkflow, s: ImageSettings, seed: number, opts: DetailerOptions | undefined) {
  if (!adetailerWanted(s)) return;
  if (!opts) throw new Error("ADetailer ist eingeschaltet, aber auf dem Pod nicht verfügbar");
  const sampler = node(wf, "7").inputs;
  const save = node(wf, "15").inputs;
  const shared = {
    ...defaultsFromSpec(opts.spec),
    model: sampler.model,
    positive: sampler.positive,
    negative: sampler.negative,
    clip: node(wf, "4").inputs.clip,
    vae: node(wf, "8").inputs.vae,
    seed,
    // SDXL-Auflösung für den neu gerechneten Ausschnitt
    guide_size: 1024,
    max_size: 1024,
    steps: Math.min(20, Math.max(1, Math.round(s.steps))),
    cfg: s.cfg,
    sampler_name: s.sampler,
    scheduler: s.scheduler,
    wildcard: "",
  };

  const passes: { id: string; det: string; model: string | null | undefined; denoise: number; title: string; extra?: Record<string, unknown> }[] = [];
  if (s.adetailer) passes.push({ id: "970", det: "960", model: opts.faceModel, denoise: s.adetailerDenoise ?? 0.4, title: "ADetailer Gesicht" });
  if (s.adetailerHands)
    passes.push({
      id: "971",
      det: "961",
      model: opts.handModel,
      denoise: s.adetailerHandDenoise ?? 0.45,
      title: "ADetailer Hände",
      // Hände sind klein und oft nur halb sichtbar: etwas großzügiger erkennen und ausschneiden
      extra: { bbox_threshold: 0.35, bbox_dilation: 15 },
    });

  let image = save.images;
  for (const p of passes) {
    if (!p.model) throw new Error(`${p.title}: Erkennungsmodell fehlt auf dem Pod`);
    wf[p.det] = { class_type: "UltralyticsDetectorProvider", inputs: { model_name: p.model }, _meta: { title: `${p.title} – Erkennung` } };
    wf[p.id] = {
      class_type: "FaceDetailer",
      inputs: { ...shared, ...p.extra, image, denoise: Math.min(1, Math.max(0.05, p.denoise)), bbox_detector: [p.det, 0] },
      _meta: { title: p.title },
    };
    image = [p.id, 0];
  }
  save.images = image;
}
