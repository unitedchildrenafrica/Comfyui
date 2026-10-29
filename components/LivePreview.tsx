"use client";

import type { LiveSnapshot } from "@/hooks/useLive";

/**
 * Live-Vorschau während des Samplings. Bei H3 kommt sie von der KJ-Node als kurzes MP4
 * (mit Ton) – stumm im Loop, Ton über die Steuerung einschaltbar.
 */
export function LivePreview({ live, className = "max-h-96" }: { live: LiveSnapshot; className?: string }) {
  if (!live.previewSeq || !live.previewMime) return null;
  const src = `/api/preview?seq=${live.previewSeq}`;
  return (
    <div className="space-y-1">
      {live.previewMime?.startsWith("video/") ? (
        <video key={src} src={src} autoPlay loop muted playsInline controls className={`mx-auto w-full rounded-lg bg-black ${className}`} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="Live-Vorschau" className={`mx-auto rounded-lg ${className}`} />
      )}
      {live.previewStep !== null && <p className="text-center text-xs text-muted">Vorschau von Step {live.previewStep}</p>}
    </div>
  );
}
