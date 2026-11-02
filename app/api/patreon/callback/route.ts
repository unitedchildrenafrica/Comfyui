/** Als „Umleitungs-URI“ im Patreon-Portal eingetragen. Die App nutzt den Creator-Token direkt,
 *  ein Login über Patreon ist nicht nötig – deshalb nur ein Hinweis. */
export function GET() {
  return new Response("Patreon ist über den Creator-Token angebunden – hier ist nichts zu tun. Du kannst dieses Fenster schließen.", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
