"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/bild", label: "Bild", icon: "🖼️" },
  { href: "/video", label: "Video", icon: "🎬" },
  { href: "/queue", label: "Queue", icon: "⏳" },
  { href: "/galerie", label: "Galerie", icon: "🗂️" },
  { href: "/notizen", label: "Notizen", icon: "📝" },
  { href: "/einstellungen", label: "Setup", icon: "⚙️" },
];

export function BottomNav() {
  const path = usePathname();
  if (path.startsWith("/login")) return null;
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)", left: "var(--notes-w, 0px)" }}
    >
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map((t) => {
          const active = path.startsWith(t.href) || (t.href === "/einstellungen" && path.startsWith("/modelle"));
          return (
            <li key={t.href} className="flex-1">
              <Link href={t.href} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs ${active ? "text-accent" : "text-muted"}`}>
                <span className="text-lg leading-none" aria-hidden>
                  {t.icon}
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
