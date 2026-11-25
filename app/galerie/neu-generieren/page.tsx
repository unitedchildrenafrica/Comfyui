"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorBox, Select, Toggle, WarnBox } from "@/components/ui";
import { redownload } from "@/lib/characterTools";
import { api, ApiError } from "@/lib/client";
import { MODEL_TYPES } from "@/lib/modelLinks";
import type { RestoreSet } from "@/lib/restore";

const PAGE = 15;

interface SubmitResult {
  promptIds: string[];
  failed: { name: string; error: string }[];
}

const dateLabel = (ms: number) =>
  new Date(ms).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const GEN_LABEL: Record<string, string> = { wai: "WAI", pony: "Pony", anima: "Anima", krea2: "Krea 2", h3: "Video H3" };

function count(s: Pick<RestoreSet, "kind" | "jobs" | "perJob">) {
  const n = s.jobs * s.perJob;
  return s.kind === "video" ? `${n} ${n === 1 ? "Video" : "Videos"}` : `${n} ${n === 1 ? "Bild" : "Bilder"}`;
}

function statusOf(s: RestoreSet): { text: string; cls: string } {
  if (s.restored >= s.jobs) return { text: "↻ schon neu gestartet", cls: "text-accent" };
  if (s.present === 0) return { text: "gelöscht", cls: "text-red-300" };
  if (s.present < s.jobs) return { text: `${s.jobs - s.present} von ${s.jobs} gelöscht`, cls: "text-amber-300" };
  return { text: "noch in der Galerie", cls: "text-emerald-300" };
}

export default function RestorePage() {
  const [sets, setSets] = useState<RestoreSet[] | null>(null);
  const [podOnline, setPodOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState("");
  const [onlyDeleted, setOnlyDeleted] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [dl, setDl] = useState<Record<string, { busy?: boolean; ok?: boolean; error?: string }>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const tz = new Date().getTimezoneOffset();
  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api<{ sets: RestoreSet[]; podOnline: boolean }>(`/api/restore?tz=${tz}`);
      setSets(r.sets);
      setPodOnline(r.podOnline);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }, [tz]);
  useEffect(() => {
    load();
  }, [load]);

  const folders = useMemo(() => [...new Set((sets ?? []).map((s) => s.folder))].sort((a, b) => a.localeCompare(b, "de")), [sets]);
  const filtered = useMemo(
    () => (sets ?? []).filter((s) => (!folder || s.folder === folder || s.folder.startsWith(folder + "/")) && (!onlyDeleted || s.present < s.jobs)),
    [sets, folder, onlyDeleted],
  );
  const shown = filtered.slice(0, limit);
  const chosen = (sets ?? []).filter((s) => selected.has(s.key));
  const chosenJobs = chosen.reduce((n, s) => n + s.jobs, 0);
  const chosenFiles = chosen.reduce((n, s) => n + s.jobs * s.perJob, 0);
  const hasVideo = chosen.some((s) => s.kind === "video");

  // Modelle der Auswahl, die noch geladen werden müssen bzw. gar nicht zu bekommen sind
  const needLoad = uniqueBy(chosen.flatMap((s) => s.models.filter((m) => m.status === "link")), (m) => `${m.role}|${m.name}`);
  const noLink = uniqueBy(chosen.flatMap((s) => s.models.filter((m) => m.status === "missing")), (m) => `${m.role}|${m.name}`);
  const pendingLoad = needLoad.filter((m) => !dl[`${m.role}|${m.name}`]?.ok);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const load1 = async (m: RestoreSet["models"][number]) => {
    const k = `${m.role}|${m.name}`;
    if (!m.url) return;
    setDl((s) => ({ ...s, [k]: { busy: true } }));
    try {
      await redownload(m.name, m.url, m.type, m.role === "video" ? "video" : "image");
      setDl((s) => ({ ...s, [k]: { ok: true } }));
    } catch (err) {
      setDl((s) => ({ ...s, [k]: { error: (err as Error).message } }));
    }
  };

  const start = async () => {
    if (!chosen.length) return;
    const what = hasVideo && chosen.every((s) => s.kind === "video") ? count({ kind: "video", jobs: 1, perJob: chosenFiles }) : hasVideo ? `${chosenJobs} Jobs` : count({ kind: "image", jobs: 1, perJob: chosenFiles });
    if (!window.confirm(`${chosen.length} ${chosen.length === 1 ? "Set" : "Sets"} mit den Original-Prompts und -Seeds neu generieren (${what})?`)) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<SubmitResult>("/api/restore", { method: "POST", json: { keys: [...selected], tz } });
      setResult(r);
      if (r.promptIds.length) setSelected(new Set());
      load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-lg font-semibold">Sets neu generieren</h1>
        <Link href="/galerie" className="text-sm text-accent underline">
          ← Galerie
        </Link>
      </div>
      <p className="px-1 text-sm text-muted">
        Prompt, Seed und alle Einstellungen jedes Jobs sind gespeichert, auch wenn die Bilder gelöscht sind. Neu generiert landen sie wieder im selben Ordner unter
        demselben Namen.
      </p>

      {error && <ErrorBox>{error}</ErrorBox>}
      {!podOnline && <WarnBox>Kein Pod erreichbar. Die Sets siehst du trotzdem, zum Generieren muss aber ein Pod laufen. Ob die Modelle da sind, ist bis dahin unbekannt.</WarnBox>}

      <Select value={folder} onChange={(v) => { setFolder(v); setLimit(PAGE); }} options={[{ value: "", label: "Alle Ordner" }, ...folders]} />
      <Toggle checked={onlyDeleted} onChange={(v) => { setOnlyDeleted(v); setLimit(PAGE); }} label="Nur gelöschte Sets" />

      {result && (
        <section className="card space-y-2 p-3 text-sm">
          {result.promptIds.length > 0 && (
            <p className="text-emerald-300">
              ✓ {result.promptIds.length} {result.promptIds.length === 1 ? "Job" : "Jobs"} in der Warteschlange.{" "}
              <Link href="/queue" className="text-accent underline">
                Zur Queue
              </Link>
            </p>
          )}
          {result.failed.map((f, i) => (
            <p key={i} className="text-red-300">
              ✗ {f.name}: {f.error}
            </p>
          ))}
        </section>
      )}

      {sets === null && !error && <p className="px-1 text-sm text-muted">Lade …</p>}
      {sets && !filtered.length && <p className="px-1 text-sm text-muted">{onlyDeleted ? "Keine gelöschten Sets gefunden." : "Keine Sets gefunden."}</p>}

      <ul className="space-y-2">
        {shown.map((s) => {
          const st = statusOf(s);
          const isSel = selected.has(s.key);
          const missing = s.models.filter((m) => m.status !== "here" && m.status !== "unknown").length;
          return (
            <li key={s.key} className={`card overflow-hidden ${isSel ? "ring-2 ring-accent" : ""}`}>
              <div className="flex items-start gap-3 p-3">
                <input type="checkbox" className="mt-1 h-6 w-6 shrink-0" checked={isSel} onChange={() => toggle(s.key)} aria-label={`Set ${s.folder} auswählen`} />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => toggle(s.key)}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">📁 {s.folder}</span>
                    <span className="text-xs text-muted">{dateLabel(s.createdAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-2 text-xs">
                    <span className="text-soft">
                      {count(s)} · {GEN_LABEL[s.generator] ?? s.generator}
                    </span>
                    <span className={st.cls}>{st.text}</span>
                    {missing > 0 && <span className="text-amber-300">⚠ {missing} Modell{missing === 1 ? "" : "e"} fehlt</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{s.preview}</p>
                </button>
              </div>
              <button type="button" className="w-full border-t border-line px-3 py-2 text-left text-xs text-accent" onClick={() => setOpen(open === s.key ? null : s.key)}>
                {open === s.key ? "▲ weniger" : "▼ Details und Modelle"}
              </button>
              {open === s.key && (
                <div className="space-y-3 border-t border-line p-3 text-sm">
                  <div>
                    <p className="mb-1 text-xs text-muted">Modelle</p>
                    <ul className="space-y-1">
                      {s.models.map((m) => {
                        const k = `${m.role}|${m.name}`;
                        const d = dl[k];
                        return (
                          <li key={k} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className={m.status === "here" ? "text-emerald-300" : m.status === "unknown" ? "text-muted" : "text-red-300"}>
                              {m.status === "here" ? "✓" : m.status === "unknown" ? "•" : "✗"}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {m.name} <span className="text-xs text-muted">{MODEL_TYPES[m.type]?.label}</span>
                            </span>
                            {m.status === "link" &&
                              (d?.ok ? (
                                <span className="text-xs text-emerald-300">lädt ↓</span>
                              ) : (
                                <button type="button" className="h-9 rounded-lg border border-line px-3 text-xs text-soft" disabled={d?.busy} onClick={() => load1(m)}>
                                  {d?.busy ? "…" : "⬇ Laden"}
                                </button>
                              ))}
                            {m.status === "missing" && <span className="text-xs text-red-300">kein Link gespeichert</span>}
                            {d?.error && <span className="w-full text-xs text-red-300">{d.error}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted">Namen ({s.jobs})</p>
                    <p className="text-xs text-soft">
                      {s.names.slice(0, 12).join(", ")}
                      {s.jobs > 12 ? ` … +${s.jobs - 12}` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted">Prompt (erster Job)</p>
                    <p className="whitespace-pre-wrap break-words text-xs text-soft">{s.preview}</p>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {filtered.length > limit && (
        <button type="button" className="btn btn-ghost w-full" onClick={() => setLimit(limit + PAGE)}>
          Mehr anzeigen ({filtered.length - limit} weitere)
        </button>
      )}

      {chosen.length > 0 && (
        <div className="sticky-action space-y-2">
          {(pendingLoad.length > 0 || noLink.length > 0) && (
            <div className="card space-y-2 p-3 text-sm shadow-lg shadow-black/40">
              {pendingLoad.length > 0 && (
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 text-amber-300">
                    ⚠ {pendingLoad.length} {pendingLoad.length === 1 ? "Modell fehlt" : "Modelle fehlen"} auf dem Pod
                  </p>
                  <button type="button" className="btn btn-ghost min-h-10 shrink-0 px-3 text-sm" onClick={() => pendingLoad.forEach(load1)}>
                    ⬇ Laden
                  </button>
                </div>
              )}
              {noLink.length > 0 && (
                <p className="text-red-300">
                  ✗ Kein Link gespeichert: {noLink.map((m) => m.name).join(", ")}. Per Hand unter{" "}
                  <Link href="/modelle" className="underline">
                    Modelle
                  </Link>{" "}
                  laden (gleicher Dateiname), sonst schlägt das Set fehl.
                </p>
              )}
              {Object.values(dl).some((d) => d.ok) && (
                <p className="text-xs text-muted">
                  Lädt, Fortschritt unter{" "}
                  <Link href="/modelle" className="text-accent underline">
                    Modelle
                  </Link>
                  . Danach{" "}
                  <button type="button" className="text-accent underline" onClick={load}>
                    ↻ hier prüfen
                  </button>
                  .
                </p>
              )}
            </div>
          )}
          <button type="button" className="btn btn-primary h-14 w-full text-lg shadow-lg shadow-black/40" disabled={busy || !podOnline} onClick={start}>
            {busy
              ? "Wird eingereiht …"
              : `Neu generieren – ${chosen.length} ${chosen.length === 1 ? "Set" : "Sets"} (${chosenJobs} ${chosenJobs === 1 ? "Job" : "Jobs"})`}
          </button>
        </div>
      )}
    </main>
  );
}

function uniqueBy<T>(list: T[], key: (x: T) => string): T[] {
  const m = new Map<string, T>();
  for (const x of list) if (!m.has(key(x))) m.set(key(x), x);
  return [...m.values()];
}
