import { NotesPanel } from "@/components/notes/NotesPanel";

export const metadata = { title: "Notizen" };

export default function NotesPage() {
  return (
    <main className="page lg:max-w-4xl">
      <h1 className="px-1 text-lg font-semibold">Notizen</h1>
      <NotesPanel />
    </main>
  );
}
