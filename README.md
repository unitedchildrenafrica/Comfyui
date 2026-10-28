# Pod-Frontend

Mobile Web-App (Next.js) für ComfyUI. Läuft direkt auf dem GPU-Pod (Vast.ai / RunPod) neben ComfyUI und ist über einen Cloudflare Tunnel unter **https://comfy.comfyusel.uk** erreichbar.

- **Bild:** WAI / Pony / Anima, bedient wie TensorHub Text2Img, Einzel- und Batch-Prompts (200+ Blöcke, alle sofort serverseitig in der Queue)
- **Video:** MiniMax H3 (DaSiWa-Director), Prompt-Blöcke, Referenzbilder und Audio
- **Warteschlange, Galerie, Einstellungen**, Login mit einem Passwort, als PWA installierbar

Die Bauanleitung (Spezifikation) steht in [`CLAUDE.md`](CLAUDE.md).

---

## Einmalige Einrichtung

### 1. Cloudflare Tunnel anlegen

1. Cloudflare-Dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** → Typ **Cloudflared**
2. Name z. B. `comfy-pod` → Speichern
3. Beim Schritt „Install connector“ den **Token** kopieren (der lange String nach `--token`). Das ist `CF_TUNNEL_TOKEN`.
4. Reiter **Public Hostname** → **Add a public hostname**:
   - Subdomain: `comfy`, Domain: `comfyusel.uk`
   - Service: Typ `HTTP`, URL `127.0.0.1:3000`
5. Speichern. Der DNS-Eintrag `comfy.comfyusel.uk` wird automatisch angelegt.

> Laufen **zwei Pods gleichzeitig mit demselben Tunnel-Token**, verteilt Cloudflare die Anfragen auf beide. Das gibt ein Durcheinander mit Queue und Galerie. Immer nur einen Pod mit dem Token laufen lassen.

### 2. GitHub-Token zum Herunterladen des Releases

GitHub → Settings → Developer settings → **Fine-grained personal access token**:
- Repository access: nur `unitedchildrenafrica/Comfyui`
- Permissions: **Contents: Read-only**

Das ist `GH_TOKEN`.

### 3. Pod-Template (Vast / RunPod): Umgebungsvariablen

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `APP_PASSWORD` | ja | Login-Passwort der App |
| `GH_TOKEN` | ja (privates Repo) | Read-only-Token aus Schritt 2 |
| `CF_TUNNEL_TOKEN` | empfohlen | Tunnel-Token aus Schritt 1. Fehlt er, startet ein Quick Tunnel mit zufälliger `trycloudflare.com`-Adresse |
| `DISCORD_WEBHOOK_URL` | nein | Schickt „Pod bereit: …“ plus GPU-Name, sobald alles läuft (beim Quick Tunnel mit der zufälligen Adresse) |
| `SESSION_SECRET` | nein | Signiert das Login-Cookie. Ohne Angabe wird einer erzeugt und in `DATA_DIR` gespeichert |
| `COMFY_URL` | nein | Standard `http://127.0.0.1:8188` |
| `DATA_DIR` | nein | Standard `/workspace/pod-frontend-data` (Presets, Job-Einstellungen) |

### 4. Start-Skript einhängen

Am Ende des bestehenden Pod-Setup-Skripts:

```bash
curl -fsSL -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github.raw" \
  https://api.github.com/repos/unitedchildrenafrica/Comfyui/contents/pod/start-frontend.sh?ref=main \
  -o /workspace/start-frontend.sh && bash /workspace/start-frontend.sh
```

Das Skript (`pod/start-frontend.sh`) installiert bei Bedarf Node 22 und cloudflared, lädt das neueste Release nach `/opt/pod-frontend`, startet die App mit einer Neustart-Schleife auf `127.0.0.1:3000`, wartet auf ComfyUI und startet dann den Tunnel. Logs liegen in `/workspace/logs/frontend.log` und `/workspace/logs/tunnel.log`. Mehrfach ausführen ist ok.

---

## Release / Deployment

Jeder Push auf `main` startet `.github/workflows/release.yml`: Typecheck, Tests, `next build` (standalone) → `pod-frontend.tar.gz` im Release **`latest`** (wird jedes Mal ersetzt). Manuell starten geht über **Actions → Release → Run workflow**. Auf dem Pod wird nichts gebaut.

App auf einem laufenden Pod aktualisieren: `bash /workspace/start-frontend.sh` erneut ausführen.

---

## Lokale Entwicklung (ohne Pod)

```bash
npm install
npm run mock          # ComfyUI-Attrappe auf :8188 (Queue, Fortschritt, WebSocket, Galerie)
APP_PASSWORD=test DATA_DIR=./data npm run dev
npm test              # Builder- und Parser-Tests
```

---

## Aufbau

```
lib/builders/       wai.ts, anima.ts, h3.ts: reine Funktionen Settings → API-Workflow
lib/batch.ts        Batch-Prompt-Parser (positive:/negative:/name:, Blöcke mit ---)
lib/h3prompt.ts     H3-Prompt-Blöcke bauen/zerlegen, Dialog-Prüfhilfe
lib/server/         ComfyUI-Client, WebSocket→SSE-Hub, Datenablage, Job-Einreihung
app/api/            Route Handlers (Proxy zu ComfyUI, der Browser spricht nie direkt mit ComfyUI)
app/{bild,video,queue,galerie,einstellungen}   Seiten
proxy.ts            Login-Schutz aller Seiten und API-Routen
workflows/          API-Exporte (Templates)
pod/start-frontend.sh
```

### MiniMax H3: Wie Prompt und Referenzen übergeben werden

Ermittelt aus dem Quellcode von `ComfyUI-DaSiWa-Nodes` (`nodes/nodes_minimax_h3_director.py`):

- Der Director liest den Prompt aus `builder_state`. Ist der leer, nimmt er `timeline_data.resolved_prompt` (im Export das leere Gerüst), das `prompt`-Widget allein würde **ignoriert**. Die App setzt deshalb `builder_state` mit `prompt_mode: "simple"` und dem fertigen Text, dazu `resolved_prompt` und `prompt`.
- Referenzen stehen in `timeline_data.items` als `{type: "image"|"audio", value: "<Datei im input-Ordner>", slot, order, enabled}`. Upload per `/upload/image` (auch für Audio). Nummeriert wird nach Typ, dann nach Reihenfolge, daraus ergeben sich `<Picture 1>`, `<Audio 1>` … für den Prompt. FL2VA: slot 0 = erstes, slot 1 = letztes Bild.
- Grenzen laut Node: 9 Bilder, 3 Audios, Audio braucht ein Bild, Audio gesamt höchstens 15 s.

## Offen / noch gegen einen echten Pod zu prüfen

- [ ] Alles einmal am echten Pod durchtesten (bisher nur gegen die Attrappe `dev/mock-comfy.mjs` gelaufen)
- [ ] Anima: Welche Shift-Node richtig ist (`ModelSamplingAuraFlow` wird bevorzugt, sonst `ModelSamplingSD3`). Ergebnis in `lib/builders/anima.ts` notieren
- [ ] H3: Testlauf ohne und mit Refs; prüfen, ob `width`/`height` gegen `timeline_data.resolution` gewinnen
- [ ] Phase 2: ADetailer (FaceDetailer), Continuity-Fortsetzung, Benachrichtigung bei fertigem Batch
