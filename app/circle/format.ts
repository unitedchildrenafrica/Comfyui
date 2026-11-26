// Anzeige-Helfer für den Inner-Circle-Tab

/** „2026-11-12T08:00:00+00:00“ oder „2026-11-12“ → „12.11.2026“ */
export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return "–";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  if (iso.length === 10) return `${m[3]}.${m[2]}.${m[1]}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Zyklus-ID → „Nov 2026“ bzw. „vor 1. Zahlung“ */
export function cycleLabel(id: string): string {
  if (id === "start") return "vor der 1. Zahlung";
  const d = new Date(`${id}T12:00:00`);
  return Number.isNaN(d.getTime()) ? id : d.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
}

export const dollars = (cents: number) => `$${(cents / 100).toLocaleString("de-DE", { maximumFractionDigits: cents % 100 ? 2 : 0 })}`;

/** Heute als JJJJ-MM-TT in lokaler Zeit */
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
