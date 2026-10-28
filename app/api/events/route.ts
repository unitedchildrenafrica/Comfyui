import { getLiveState, onChange } from "@/lib/server/events";

export const dynamic = "force-dynamic";

/** Server-Sent Events: leitet den ComfyUI-WebSocket an den Browser weiter. */
export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      let pending: ReturnType<typeof setTimeout> | null = null;
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const snapshot = () => {
        const s = getLiveState();
        return {
          connected: s.connected,
          runningPromptId: s.runningPromptId,
          node: s.node,
          progress: s.progress,
          queueRemaining: s.queueRemaining,
          previewSeq: s.previewSeq,
        };
      };
      send("state", snapshot());

      const off = onChange(({ event, extra }) => {
        if (event === "finished") {
          const { promptId } = extra as { promptId: string };
          send("finished", { ...(extra as object), error: getLiveState().errors[promptId] ?? null });
        }
        // Zustand gedrosselt senden (Vorschau-Frames kommen sehr schnell)
        if (!pending) {
          pending = setTimeout(() => {
            pending = null;
            send("state", snapshot());
          }, 250);
        }
      });
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 15_000);
      cleanup = () => {
        off();
        clearInterval(ping);
        if (pending) clearTimeout(pending);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
