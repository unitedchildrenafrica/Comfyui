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
| `CIVITAI_TOKEN` | ja | Civitai-API-Token für die Modell-Downloads |
| `HF_TOKEN` | für `video` | Hugging-Face-Token für die H3-Modelle |
| `GH_TOKEN` | ja (privates Repo) | Read-only-Token aus Schritt 2 |
| `CF_TUNNEL_TOKEN` | empfohlen | Tunnel-Token aus Schritt 1. Fehlt er, startet ein Quick Tunnel mit zufälliger `trycloudflare.com`-Adresse |
| `DISCORD_WEBHOOK_URL` | nein | Schickt „Pod bereit: …“ plus GPU-Name, sobald alles läuft (beim Quick Tunnel mit der zufälligen Adresse) |
| `SESSION_SECRET` | nein | Signiert das Login-Cookie. Ohne Angabe wird einer erzeugt und in `DATA_DIR` gespeichert |
| `COMFY_URL` | nein | Standard im Pod-Skript `http://127.0.0.1:18188` |
| `DATA_DIR` | nein | Standard `/workspace/pod-frontend-data` (Presets, Job-Einstellungen) |

### 4. Setup-Skript für jeden neuen Pod

`pod/setup.sh` richtet einen frischen Vast-Pod (ComfyUI-Template) komplett ein. Es gibt drei Modi:

| Modus | Inhalt |
|---|---|
| `bilder` | Inspire Pack, WAI v10/v17, Aniverse Pony, Pony V6, Nova 3DCG, Illu-Merge, Anima (+ Turbo, Encoder, VAE), Remacri, Bild-LoRAs |
| `video` | MiniMax H3 Singularity: ComfyUI-Update, Custom Nodes (DaSiWa, KJNodes, VHS …), DiT, Text-Encoder, VAEs, TAE, RIFE, H3-LoRAs, x264-Patch |
| `alles` | beides |

In jedem Modus startet es außerdem sofort im Hintergrund das Pod-Frontend und den Tunnel (`pod/start-frontend.sh`), schreibt `/workspace/start_comfy.sh` und startet ComfyUI auf Port **18188**. Am Ende prüft es die Nodes und meldet Probleme (optional per Discord). Vorhandene Dateien werden übersprungen, also bei Fehlern einfach nochmal starten.

**Nur Bilder:**

```bash
curl -fsSL -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github.raw" "https://api.github.com/repos/unitedchildrenafrica/Comfyui/contents/pod/setup.sh?ref=main" -o /workspace/setup.sh && bash /workspace/setup.sh bilder
```

**Nur MiniMax H3:**

```bash
curl -fsSL -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github.raw" "https://api.github.com/repos/unitedchildrenafrica/Comfyui/contents/pod/setup.sh?ref=main" -o /workspace/setup.sh && bash /workspace/setup.sh video
```

**Alles:**

```bash
curl -fsSL -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github.raw" "https://api.github.com/repos/unitedchildrenafrica/Comfyui/contents/pod/setup.sh?ref=main" -o /workspace/setup.sh && bash /workspace/setup.sh alles
```

Optionen: `WITH_QWEN=1` (baut llama-cpp-python für den Qwen-Prompt-Schreiber), `SKIP_FRONTEND=1` (ohne App/Tunnel).

Nach einem Pod-Neustart reicht: `bash /workspace/start_comfy.sh` und `bash /workspace/start-frontend.sh`.

`pod/start-frontend.sh` installiert bei Bedarf Node 22 und cloudflared, lädt das neueste Release nach `/opt/pod-frontend`, startet die App mit Neustart-Schleife auf `127.0.0.1:3000` und dann den Tunnel. Logs: `/workspace/logs/start-frontend.log`, `frontend.log`, `tunnel.log`, ComfyUI: `/workspace/comfy.log`.

### 5. Modelle per Link laden (in der App)

**Setup → „Checkpoint / LoRA per Link laden“** (oder der Link unter jeder LoRA-Liste): Link einfügen → **Link prüfen** → Zielordner und Dateiname kontrollieren → **Herunterladen**. Der Download läuft auf dem Pod weiter, auch wenn das Handy gesperrt ist. Fertige Dateien stehen sofort in den Auswahllisten.

- **Civitai:** Modellseite (`civitai.red/models/…`, Version wählbar) oder Download-Link (`/api/download/models/…`). Typ und Ordner werden erkannt (Checkpoint, LoRA, Anima → `diffusion_models`, Text-Encoder, VAE).
- **Hugging Face:** Datei-Link (`…/blob/…` oder `…/resolve/…`).
- **Direkter Link** zu einer `.safetensors`/`.pth`-Datei.

Die App nutzt dafür `CIVITAI_TOKEN` und `HF_TOKEN` aus dem Pod-Template und speichert nach `MODELS_DIR` (Standard `/workspace/ComfyUI/models`). Vorhandene Dateien werden nicht überschrieben; abgebrochene Downloads setzen beim nächsten Versuch fort.

**Früher geladen:** Jede Datei, die einmal hierüber kam, behält ihren Download-Link (ohne Token, in `DATA_DIR/model-links.json`). Fehlt sie auf dem Pod – gelöscht oder frischer Pod –, steht sie unter „Früher geladen“ mit **⬇ Neu laden** (bzw. „Alle fehlenden neu laden“). Sie kommt unter demselben Dateinamen zurück, damit Presets und Charaktere weiter passen.

**LoRAs für Bild und Video getrennt:** Bei „Bild“ stehen nur Bild-LoRAs zur Auswahl, bei „Video“ nur Video-LoRAs. Automatisch zugeordnet werden die LoRAs aus `pod/setup.sh`, Dateien in Unterordnern wie `loras/video/…` oder `loras/pony/…` und Namen mit „minimax“/„h3“. Beim Herunterladen einer LoRA fragt die App „für Bilder / für Videos“. Alles andere unter **Modelle laden → „LoRAs: Bild oder Video“** mit einem Tipp zuordnen (gespeichert in `DATA_DIR/lora-kinds.json`). Nicht zugeordnete erscheinen in beiden Listen.

### 6. Ganze Ordner als ZIP

In der **Galerie** einen Ordner wählen (z. B. `wai`, `anima`, `video`) → **„📦 Ordner als ZIP“**. Die App packt alle Bilder/Videos des Ordners (inkl. Unterordner) direkt aus dem ComfyUI-Ausgabeordner (`OUTPUT_DIR`, Standard `/workspace/ComfyUI/output`). Damit sind auch große Batches komplett dabei. „Alle Ordner“ lädt alles.

### 6b. Notizen (Aufträge, Posten, Charaktere …)

Am PC/Mac steht links eine Notizen-Leiste (Breite am Rand ziehen, Doppelklick = Standardbreite, „einklappen“ blendet sie aus). Am Handy ist es der Tab **📝 Notizen**. Gespeichert wird in `DATA_DIR/notes/` – im Server-Modus also auf dem eigenen Server, unabhängig vom Pod.

- **Aufträge:** Person, Charakter/Set, Bild oder Video, Status *Offen → In Arbeit → Zu schicken → Verschickt*, optional Deadline, „bezahlt“, Notiz
- **Schicken:** alles „Zu schicken“ nach Person gruppiert, „✓ alle an …“, „Alles verschickt“, „Liste kopieren“
- **Posten:** Unreleased → Zu posten → Gepostet, mit Tier, Datum und Post-Text zum Kopieren
- **Ideen:** Charakter-Ideen und Wünsche von Patrons, ▲ zählt Wünsche hoch
- **Charaktere:** Prompt, LoRAs (mit Stärke und Download-Link) und Checkpoint; „Ins Bild-Formular“ setzt alles ein. Fehlt eine LoRA auf dem Pod, gibt es „⬇ laden“
- **Monat:** wiederkehrende Aufgaben, die Haken gelten nur für den laufenden Monat
- **Befehle:** Schnipsel mit Kopier-Knopf
- **Notiz:** freies Textfeld, speichert automatisch; bei gleichzeitiger Änderung auf zwei Geräten wird gefragt statt überschrieben

Oben stehen die Zähler (offen / zu schicken / unreleased / zu posten), die Suche geht über alle Listen.

### 7. Server-Modus: App dauerhaft auf eigenem Server (z. B. one.com)

Die App läuft dann **immer** auf deinem Server unter `https://comfy.comfyusel.uk`, auch ohne Pod. Der GPU-Pod rechnet nur und meldet sich beim Start selbst an. Fertige Bilder und Videos werden **automatisch auf den Server kopiert**. Galerie, Favoriten, ZIP und Löschen funktionieren deshalb auch, wenn gerade kein Pod läuft. „Modelle laden“ wird an den Pod weitergereicht.

```
Handy ──► comfy.comfyusel.uk ──► Server (App, Galerie, Bots)
                                    │  Pod meldet sich an (POD_SECRET)
                                    ▼
                    Pod-Gateway (prüft POD_SECRET) ──► ComfyUI / Pod-App
```

**1. Auf dem Server** (Ubuntu 24.04, als root):

```bash
curl -fsSL -H "Authorization: Bearer DEIN_GH_TOKEN" -H "Accept: application/vnd.github.raw" "https://api.github.com/repos/unitedchildrenafrica/Comfyui/contents/server/setup-server.sh?ref=main" -o /root/setup-server.sh && bash /root/setup-server.sh
```

Beim ersten Mal fragt das Skript nach GitHub-Token, App-Passwort und dem bisherigen `CF_TUNNEL_TOKEN`. Am Ende zeigt es das **POD_SECRET** an. Es richtet App und Tunnel als systemd-Dienste ein: Start beim Booten, Neustart bei Absturz, max. 1,5 GB RAM, damit Platz für die Bots bleibt. **Update:** `bash /root/setup-server.sh` erneut ausführen.

**2. Im Vast-Template:**
- **eintragen:** `VPS_URL=https://comfy.comfyusel.uk` und `POD_SECRET=…` (aus Schritt 1)
- **entfernen:** `CF_TUNNEL_TOKEN`. Der Tunnel läuft jetzt auf dem Server. Läuft er zusätzlich noch auf einem Pod, verteilt Cloudflare die Anfragen auf beide.

**3. Pod starten wie gewohnt** (`setup.sh bilder|video|alles`). Statt App-Tunnel startet der Pod dann:
- das **Gateway** (`pod/pod-gateway.mjs`, lässt nur Anfragen mit POD_SECRET durch)
- einen Tunnel mit Zufalls-Adresse
- ein **Lebenszeichen** an den Server, jede Minute

In der App zeigt **Setup → Server-Modus**, ob ein Pod verbunden ist. Optional geht statt der Zufalls-Adresse ein fester zweiter Tunnel: `CF_GPU_TUNNEL_TOKEN` + `GPU_PUBLIC_URL`.

Logs auf dem Server: `journalctl -u pod-frontend -f`. Auf dem Pod: `/workspace/logs/gateway.log`, `heartbeat.log`.

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

### Video-Clips automatisch benennen

Steht in der **ersten Zeile** des eingefügten Prompts z. B. `Clip 35`, wird daraus der Dateiname (`video/<Datum>/Clip_35_00001.mp4`, bei erneutem Rendern `_00002` …) und der Name in der Galerie. Die Zeile gehört nicht zum Prompt. Erkannt werden `Clip 35`, `Clip #35`, `Szene 3`, `Shot 12`, `Name: …`, auch mit Markdown (`**Clip 35**`) oder im Code-Block, und jede kurze Zeile direkt über den Blöcken. Ohne solche Zeile bleibt es beim Namen nach Uhrzeit. Das Feld „Clip-Name“ lässt sich auch von Hand setzen, „+1“ zählt die Nummer hoch.

Anweisung für Claude, z. B.: *„Schreib in die allererste Zeile nur `Clip <Nummer>`, danach eine Leerzeile und dann den Prompt mit den Blöcken.“*

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
