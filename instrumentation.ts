// Läuft einmal beim Start des Servers.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Knete-Stil: unterbrochene Aufträge nach einem Neustart sofort fortsetzen,
  // nicht erst, wenn jemand die Seite öffnet
  const { ensureLoaded } = await import("./lib/server/knete");
  ensureLoaded().catch((err) => console.error("[knete] Aufträge laden", err));
}
