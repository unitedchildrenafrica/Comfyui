import { ComfyUnavailableError } from "./comfy";
import { getQueue } from "./history";
import { forEachPod, getPod, promptPodId, serverMode, withPod } from "./podLink";

/**
 * Auf allen verbundenen Pods ausführen (Server-Modus), sonst einfach einmal. Scheitert ein Pod,
 * zählen die anderen; nur wenn alle scheitern, gibt es einen Fehler.
 */
export async function onAllPods(fn: () => Promise<unknown>): Promise<void> {
  if (!serverMode()) {
    await fn();
    return;
  }
  const results = await forEachPod(() => fn());
  if (!results.length) throw new ComfyUnavailableError(undefined, "Kein Pod verbunden");
  if (results.every((r) => r.error !== undefined)) throw results[0].error;
}

/** Pod, auf dem dieser Job gerade läuft oder wartet (null = unbekannt bzw. nicht mehr in einer Warteschlange) */
export async function podOfQueuedPrompt(promptId: string): Promise<string | null> {
  if (!serverMode()) return null;
  const q = await getQueue();
  return [...q.running, ...q.pending].find((e) => e.promptId === promptId)?.podId ?? null;
}

/** Auf dem Pod des Jobs ausführen (gemerkt oder per Warteschlange gesucht) */
export async function onPromptPod<T>(promptId: string, fn: () => Promise<T>): Promise<T | null> {
  if (!serverMode()) return fn();
  const id = (await podOfQueuedPrompt(promptId)) ?? promptPodId(promptId);
  if (!id || !getPod(id)) return null;
  return withPod(id, fn);
}
