import type { Metadata, Viewport } from "next";
import { AlarmHost } from "@/components/Alarm";
import { BottomNav } from "@/components/BottomNav";
import { NotesSidebar } from "@/components/notes/NotesSidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pod Frontend",
  description: "ComfyUI vom Handy",
  appleWebApp: { capable: true, title: "Pod", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        {children}
        <NotesSidebar />
        <BottomNav />
        <AlarmHost />
      </body>
    </html>
  );
}
