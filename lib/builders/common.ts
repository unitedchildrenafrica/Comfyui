export type Ref = [string, number];

export interface ApiNode {
  inputs: Record<string, unknown>;
  class_type?: string;
  _meta?: { title: string };
}

export type ApiWorkflow = Record<string, ApiNode>;

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function isRef(value: unknown): value is Ref {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "number"
  );
}

export function node(wf: ApiWorkflow, id: string): ApiNode {
  const n = wf[id];
  if (!n) throw new Error(`Node ${id} fehlt im Template`);
  return n;
}

export function removeNodes(wf: ApiWorkflow, ids: string[]) {
  for (const id of ids) delete wf[id];
}

/** Liefert eine Liste aller Probleme: tote Referenzen und fehlende class_type. */
export function validateWorkflow(wf: ApiWorkflow): string[] {
  const errors: string[] = [];
  for (const [id, n] of Object.entries(wf)) {
    if (!n.class_type) errors.push(`Node ${id}: class_type fehlt`);
    for (const [key, value] of Object.entries(n.inputs)) {
      if (isRef(value) && !wf[value[0]]) {
        errors.push(`Node ${id}.${key} zeigt auf fehlende Node ${value[0]}`);
      }
    }
  }
  return errors;
}

export function assertValid(wf: ApiWorkflow): ApiWorkflow {
  const errors = validateWorkflow(wf);
  if (errors.length) throw new Error(errors.join("; "));
  return wf;
}

export function roundTo(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

export function scaledSize(width: number, height: number, factor: number) {
  return { width: roundTo(width * factor, 8), height: roundTo(height * factor, 8) };
}

const SEGMENT = /^[A-Za-z0-9_\-.]+$/;

/** Ordner wie "wai" oder "wai/serie1" – keine absoluten Pfade, kein "..". */
export function safeFolder(folder: string, fallback: string): string {
  const parts = folder
    .trim()
    .split("/")
    .filter(Boolean);
  if (!parts.length || parts.some((p) => !SEGMENT.test(p) || p === "." || p === "..")) return fallback;
  return parts.join("/");
}

export function isSafeName(name: string): boolean {
  return SEGMENT.test(name) && name !== "." && name !== "..";
}
