import { baseName } from "./notes";

/**
 * LoRA-Namen sortieren: zuletzt heruntergeladene zuerst (savedAt aus der Link-Merkliste),
 * danach alle ohne Datum (z. B. vom Pod-Setup) alphabetisch.
 */
export function sortByDownload(names: string[], links: { filename: string; savedAt: number; type?: string }[]): string[] {
  const at = new Map<string, number>();
  for (const l of links) if (l.savedAt > 0 && (!l.type || l.type === "lora")) at.set(baseName(l.filename).toLowerCase(), l.savedAt);
  const when = (n: string) => at.get(baseName(n).toLowerCase()) ?? 0;
  return [...names].sort((a, b) => when(b) - when(a) || a.localeCompare(b, "de", { sensitivity: "base" }));
}
