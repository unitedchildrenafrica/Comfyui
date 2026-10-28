# Projekt: Pod-Frontend – mobile Web-App für ComfyUI

Diese Datei ist die Bauanleitung für Claude Code. Lies sie komplett, bevor du Code schreibst.

## Ziel

Eine handyfreundliche Web-App (Next.js), die **direkt auf dem ComfyUI-Pod** (Vast.ai / RunPod, RTX 5090) läuft und über `https://comfy.comfyusel.uk` erreichbar ist. Der Nutzer will unterwegs am Handy Bilder und Videos generieren, ohne die ComfyUI-Oberfläche zu sehen. Sichtbar sind nur: **Einstellungen, Inputs, Fortschritt, Outputs.**

Drei Generatoren:

1. **WAI / Pony** (SDXL/Illustrious-Checkpoint) – ein Workflow, nur Checkpoint und LoRAs unterscheiden sich
2. **Anima** (UNet + separater Text-Encoder + VAE)
3. **MiniMax H3** (Video mit Audio, DaSiWa-Director, Referenzbilder, Audio-Refs)

Die Bedienung von WAI und Anima soll sich an **TensorHub (tensorhub.art) Text2Img** orientieren (Details unten).

Einzelnutzer-App. Kein Multi-User, keine Datenbank nötig im ersten Schritt.

---

## Tech-Stack

- Next.js (App Router), TypeScript, Tailwind
- Mobile-first, als PWA installierbar (Manifest + Icon), Dark Mode als Standard
- Alle Aufrufe an ComfyUI laufen **serverseitig** über Route Handlers (Proxy). Der Browser spricht nie direkt mit ComfyUI. Über den Tunnel ist nur die App erreichbar, ComfyUI selbst nicht.
- Fortschritt: ComfyUI-WebSocket serverseitig abonnieren und per Server-Sent Events an den Browser weitergeben. Fallback: `/history/{prompt_id}` alle 2 s pollen.
- Der Server muss als **Node-Prozess mit `next start`** laufen (`output: "standalone"` in `next.config`), nicht serverless.
- Deployment: **auf dem GPU-Pod selbst**, neben ComfyUI (siehe Abschnitt „Deployment auf dem Pod“). Kein Vercel, kein VPS.

## Zugangsschutz und Konfiguration

- Die App ist öffentlich im Internet erreichbar (über Cloudflare Tunnel). Login ist Pflicht: ein einziges Passwort aus `APP_PASSWORD` (env). Middleware schützt alle Seiten und API-Routen, Session als signiertes httpOnly-Cookie mit 30 Tagen Laufzeit, damit das Passwort am Handy nicht ständig neu eingegeben werden muss. Rate-Limit auf den Login (z. B. 5 Versuche pro Minute).
- ComfyUI-Adresse kommt aus `COMFY_URL` (env), Standard `http://127.0.0.1:8188`. Weil die App auf dem Pod läuft, ist das im Normalfall immer localhost. Eine Einstellungsseite zeigt nur den Verbindungsstatus.
- Verbindungstest: ruft `/system_stats` auf und zeigt GPU, VRAM und ComfyUI-Version.
- Presets und Job-Einstellungen in einem Datenordner `DATA_DIR` (env, Standard `/workspace/pod-frontend-data`) speichern, damit sie bei Vast/RunPod auf dem persistenten Speicher liegen und einen Neustart der App überleben.

## Deployment auf dem Pod

Ziel: Pod starten → nach ca. 1 Minute ist die App unter **`https://comfy.comfyusel.uk`** erreichbar. Immer dieselbe Adresse, egal ob Vast oder RunPod.

**Aufbau:**
- Die App läuft auf Port `3000` auf dem Pod (`node server.js` aus dem Standalone-Build).
- `cloudflared` verbindet den Pod mit einem **festen Cloudflare Tunnel** (Domain `comfyusel.uk` liegt bei Cloudflare). Der Tunnel leitet `comfy.comfyusel.uk` → `http://localhost:3000` weiter. Kein offener Port und keine Port-Freigabe beim Pod-Anbieter nötig.
- Den Tunnel legt der Nutzer einmal selbst im Cloudflare-Dashboard an (Zero Trust → Networks → Tunnels) und trägt den Tunnel-Token als Umgebungsvariable `CF_TUNNEL_TOKEN` im Pod-Template ein. Die Public-Hostname-Regel (`comfy.comfyusel.uk` → `http://localhost:3000`) wird im Dashboard gesetzt, nicht im Code.

**Build und Auslieferung:**
- GitHub Actions baut bei jedem Push auf `main` den Standalone-Build und legt ihn als `pod-frontend.tar.gz` in ein **GitHub Release** (Tag `latest`, wird jedes Mal überschrieben). Repo ist privat, Download daher mit einem Read-only-Token `GH_TOKEN` (env im Pod-Template).
- Auf dem Pod wird **nicht gebaut**. Das spart Zeit und RAM.

**Start-Skript `pod/start-frontend.sh`** (wird vom bestehenden Pod-Setup-Skript am Ende aufgerufen):
1. Node.js 22 installieren, falls nicht vorhanden
2. `cloudflared` installieren, falls nicht vorhanden
3. Neuestes Release herunterladen und nach `/opt/pod-frontend` entpacken
4. App im Hintergrund starten (mit `nohup` oder einer kleinen Neustart-Schleife, kein systemd, weil Pod-Container meist ohne systemd laufen), Logs nach `/workspace/logs/frontend.log`
5. Warten, bis ComfyUI auf `127.0.0.1:8188` antwortet
6. `cloudflared tunnel run --token $CF_TUNNEL_TOKEN` im Hintergrund starten, Logs nach `/workspace/logs/tunnel.log`
7. Optional: Ist `DISCORD_WEBHOOK_URL` gesetzt, eine Nachricht schicken: „Pod bereit: https://comfy.comfyusel.uk“ plus GPU-Name

**Fallback ohne festen Tunnel:** Fehlt `CF_TUNNEL_TOKEN`, stattdessen `cloudflared tunnel --url http://localhost:3000` (Quick Tunnel) starten, die zufällige `trycloudflare.com`-Adresse aus dem Log lesen und per Discord-Webhook schicken.

**Hinweis:** Laufen zwei Pods gleichzeitig mit demselben Tunnel-Token, verteilt Cloudflare die Anfragen auf beide. Das in der README erwähnen.

Das Skript muss idempotent sein: zweimal ausführen darf nichts kaputt machen. Es muss auf Vast und RunPod gleich funktionieren (Ubuntu-basierte Images, als root).

## ComfyUI-API, die du brauchst

| Zweck | Endpoint |
|---|---|
| Job starten | `POST /prompt` mit `{ prompt: <API-Workflow>, client_id }` → `prompt_id` |
| Fortschritt | `WS /ws?clientId=…` (Events: `progress`, `executing`, `executed`, `execution_error`) |
| Ergebnis | `GET /history/{prompt_id}` |
| Datei holen | `GET /view?filename=…&subfolder=…&type=output` |
| Upload (Bilder **und** Audio) | `POST /upload/image` (multipart, Feld `image`) → landet in `input/` |
| Dropdown-Inhalte | `GET /object_info/{NodeKlasse}` |
| Warteschlange | `GET /queue`, `POST /interrupt`, `POST /queue` mit `{delete:[id]}` |
| VRAM freigeben | `POST /free` mit `{unload_models:true, free_memory:true}` |

**Alle Dropdowns (Checkpoints, LoRAs, Upscaler, Sampler, Scheduler, UNets, Text-Encoder, VAEs) werden live aus `/object_info` geladen**, nie hart codiert. So erscheinen neu geladene Modelle sofort. Beispiele: `CheckpointLoaderSimple` → `ckpt_name`, `LoraLoader` → `lora_name`, `UpscaleModelLoader` → `model_name`, `KSampler` → `sampler_name` / `scheduler`, `UNETLoader` → `unet_name`, `CLIPLoader` → `clip_name`, `VAELoader` → `vae_name`.

---

## Grundprinzip: Templates patchen

Im Ordner `/workflows` liegen die API-Exporte des Nutzers:

- `workflow_WAI_TensorHub.json`
- `workflow_ANIMA_TensorHub.json`
- `MiniMaxH3WF.json`

Die App lädt das passende Template, macht eine tiefe Kopie, **setzt die Werte über die Node-IDs**, fügt bei Bedarf Nodes ein oder entfernt sie und schickt das Ergebnis an `/prompt`. Lege pro Generator eine Datei `lib/builders/<name>.ts` an, mit einer reinen Funktion `buildWorkflow(settings) → apiJson`. Dazu Unit-Tests, die prüfen, dass jede Node-Referenz `[id, slot]` auf eine existierende Node zeigt.

### Wichtig: kaputte Nodes in den WAI- und Anima-Exporten

In beiden Bild-Templates fehlen bei Node `2` und `3` die `class_type` (Felder heißen `UNKNOWN…`). Das sind die Inspire-Pack-Nodes für Batch-Prompts, die beim Export nicht geladen waren. **Diese Nodes und die Nodes `30` und `31` entfernen.** Die App übernimmt das Batching selbst (siehe „Batch-Prompts“):

- Node `4` (Positive) → `inputs.text` = positiver Prompt als String
- Node `5` (Negative) → `inputs.text` = negativer Prompt als String
- Node `50` (StringConcatenate) durch einen festen `filename_prefix` in Node `15` ersetzen: `"<ordner>/<name>"`

---

## Generator 1: WAI / Pony (Template `workflow_WAI_TensorHub.json`)

Einstellungen wie bei TensorHub:

| UI-Element | Umsetzung |
|---|---|
| **Grundmodell** (Checkpoint) | Node `1` `ckpt_name`, Dropdown aus `/object_info` |
| **LoRAs hinzufügen** (beliebig viele, je Stärke-Slider 0–2, Standard 1, Löschen-Knopf) | `LoraLoader`-Nodes dynamisch als Kette zwischen Node `1` und den Verbrauchern einfügen (siehe unten) |
| **VAE** „Automatic“ oder Auswahl | Automatic = VAE aus Node `1` (Slot 2). Bei Auswahl: neuen `VAELoader` einfügen und Nodes `8`, `12`, `14` darauf umhängen |
| **Seitenverhältnis**: Portrait 768×1152, Landscape 1152×768, Square 1024×1024, Custom (B/H, Vielfaches von 64) | Node `6` `width`/`height` |
| **Sampler** / **Planer** | Nodes `7` und `13`: `sampler_name`, `scheduler` (Standard euler_ancestral / normal) |
| **Sampling-Schritte** (Standard 15) | Node `7` `steps` |
| **CFG** (Standard 6) | Nodes `7` **und** `13` `cfg` |
| **Seed**, leer = Zufall, „letzten Seed verwenden“-Link | Nodes `7` und `13` `seed` (bei leer: zufällige 32-bit-Zahl serverseitig erzeugen und im Ergebnis anzeigen) |
| **Clip Skip** (Standard 2) | Node `70` `stop_at_clip_layer` = `-clipSkip` |
| **Hochskalieren** an/aus | aus: Nodes `40`, `41`, `11`, `12`, `13`, `14` entfernen, Node `15.images` ← `["8",0]` |
| Faktor 1x / 1.5x / 2x / 3x / 4x / custom (Standard 1.5x) | Node `11` `width`/`height` = Basis × Faktor, gerundet auf Vielfache von 8. Anzeige wie TensorHub: „von 768×1152 auf 1152×1728“ |
| **Hochskalierer** (Standard 4x_foolhardy_Remacri) | Node `41` `model_name`, Dropdown aus `/object_info/UpscaleModelLoader`. Option „Lanczos (ohne Modell)“: Nodes `40`/`41` entfernen, Node `11.image` ← `["8",0]` |
| **Hires-Schritte** (Standard 15) | Node `13` `steps` |
| **Denoising Strength** (Standard 0.35) | Node `13` `denoise` |
| **Anzahl Bilder** (1–4) | Node `6` `batch_size` |
| **ADetailer** an/aus | **Phase 2**: FaceDetailer aus dem Impact Pack nach Node `14` einhängen. Nur anbieten, wenn `/object_info/FaceDetailer` existiert, sonst Schalter ausgrauen |
| Schichtdiffusion, ENSD, Embeddings | weglassen (Embeddings kann der Nutzer als `embedding:name` in den Prompt schreiben) |

**Pony-Preset:** Gleicher Builder, nur andere Standardwerte. Speicherbare **Presets** (Name → komplettes Settings-Objekt, inklusive LoRAs) als JSON auf dem Server, mit Auswahl oben auf der Seite. Vordefinieren: „WAI v10“, „WAI v17“, „Pony“.

### LoRA-Kette einfügen (WAI)

Für jede aktive LoRA *i* einen Node `LoraLoader` mit neuer ID (z. B. `"900"+i`):
- erste LoRA: `model ← ["1",0]`, `clip ← ["1",1]`
- weitere: `model ← [vorherige,0]`, `clip ← [vorherige,1]`
- `strength_model` = `strength_clip` = Sliderwert

Danach umhängen: Nodes `7.model` und `13.model` ← letzte LoRA Slot 0, Node `70.clip` ← letzte LoRA Slot 1.

## Generator 2: Anima (Template `workflow_ANIMA_TensorHub.json`)

Gleiche Oberfläche wie WAI, mit diesen Unterschieden:

- Statt Checkpoint drei Dropdowns: **UNet** (Node `60`), **Text-Encoder** (Node `61`, `type` bleibt `qwen_image`), **VAE** (Node `62`)
- Latent ist `EmptySD3LatentImage` (Node `6`)
- Standardwerte: Sampler euler, Planer simple, 25 Schritte, CFG 3.5
- **Sampling Shift** (Standard 3): einen `ModelSamplingAuraFlow`-Node (`shift`) zwischen Node `60` und den KSamplern `7`/`13` einfügen. **Vorher mit `/object_info` prüfen, dass die Node existiert, und einen Testlauf machen.** Wirft der Pod einen Fehler, `ModelSamplingSD3` probieren und das Ergebnis im Code kommentieren.
- **Kein Clip Skip** (Feld ausblenden). LoRAs: Kette zwischen Node `60` (nur `model`) und `61` (nur `clip`); Hinweis in der UI, dass Illustrious-LoRAs nicht mit Anima funktionieren
- Hochskalieren identisch zu WAI (Nodes `40`, `41`, `11`–`14`)

## Batch-Prompts (WAI, Pony, Anima)

Zwei Eingabemodi, umschaltbar:

1. **Einzeln**: Felder Positiv / Negativ
2. **Batch**: großes Textfeld im folgenden Format, das der Nutzer so in Dateien pflegt:

```
positive: 1girl, solo, silver hair, blue eyes, portrait
negative: lowres, bad anatomy, bad hands, watermark, text
name: bild_001
---
positive: …
negative: …
name: bild_002
```

Parser: Blöcke an `---` trennen, pro Block die Zeilen `positive:`, `negative:`, `name:`. Fehlt `negative`, gilt das globale Standard-Negativ. Fehlt `name`, wird `bild_###` automatisch durchnummeriert. Fehlerhafte Blöcke vor dem Start anzeigen, nicht stillschweigend überspringen.

Die App schickt **jeden Block als eigenen `/prompt`-Job**, mit Ausgabeordner-Feld (Standard: `wai`, `pony`, `anima`) als `filename_prefix` `"<ordner>/<name>"`. Grund: Die Inspire-Batch-Nodes haben auf dem Pod bei großen Listen den RAM vollgelaufen lassen und Bilder doppelt erzeugt. Einzel-Jobs vermeiden das. Ein Batch-Fortschritt zeigt „12 / 40 fertig“, mit Abbrechen-Knopf, der die restlichen Jobs aus der Queue löscht.

**Wichtig:** Beim Klick auf „Generieren“ werden **alle** Blöcke sofort serverseitig in die ComfyUI-Queue gestellt (nicht nacheinander aus dem Browser nachgeschoben). So arbeitet der Pod den Batch auch dann komplett ab, wenn das Handy gesperrt oder der Tab geschlossen wird. `load_cap` und `start_index` aus dem alten Inspire-Workflow entfallen damit komplett. Batches mit 200+ Blöcken müssen funktionieren.

---

## Generator 3: MiniMax H3 (Template `MiniMaxH3WF.json`)

Die Node-IDs mit Doppelpunkt (`1512:2590`) stammen aus einem aufgelösten Subgraph. Sie gehören genau so in den API-Request.

### Einstellungen

| UI-Element | Node / Feld |
|---|---|
| **Modus** REF2VA / FL2VA (und was das Dropdown sonst anbietet, aus `/object_info/MiniMaxH3Director`) | `2730.mode` |
| **Dauer in Sekunden** (Slider 2–15, Standard 10) | `2730.duration` |
| **Auflösung**: Presets 1024×768, 1344×768, 768×1344, 768×1024 + Custom | `2730.width` / `height` |
| **Frame-Rate** (Standard 24) | `2730.frame_rate` |
| **Steps** (Standard 10) | `1512:2590.steps` |
| **Scheduler** | `1512:2590.scheduler` |
| **Sampler** (Standard euler) | `1512:2598.sampler_name` |
| **Seed**, leer = Zufall | `2739.seed_value` (den `seed_control_state` auf `mode: "fixed"` setzen, wenn ein Seed vorgegeben ist) |
| **DiT-Modell** | `1512:2586.unet_name` **und** `1512:2588.unet_name` (immer beide gleich setzen) |
| **Text-Encoder** | `1512:2587.clip_name` |
| **LoRAs** (bis 10, je Stärke) | `2678.stack_data` ist ein JSON-String mit 10 Slots `{on, lora, str, vs, as}`. Unbenutzte Slots `lora: "None"` |
| **Frame-Interpolation (RIFE ×2)** an/aus | aus: Node `1512:2714` und `1512:2715` entfernen, `2568.images` ← `["1512:2671",0]`, und Node `1512:2717.expression` auf `"a"` setzen (sonst wird die Ausgabe-FPS fälschlich verdoppelt) |
| **Live-Vorschau** an/aus | aus: Node `2737` entfernen, `1512:2592.model` ← `["2678",0]` |
| **Video-Qualität** (CRF, Standard 26) | `2568.quality` |

### Prompt-Eingabe (strukturiert)

Der Director-Prompt besteht aus festen Blöcken. Die App zeigt **ein Textfeld pro Block** und baut daraus den String für `2730.prompt`:

```
subject_definitions:
<…>

summary:
<…>

retention_analysis:
<…>

detailed_description:
<…>

overall_soundscape:
<…>

non_diegetic_music:
<… oder N/A>
```

Zusätzlich ein Modus „**Kompletten Prompt einfügen**“ (ein großes Feld), weil der Nutzer fertige Prompts aus Claude kopiert. Beim Einfügen die Blöcke erkennen und in die Einzelfelder verteilen, damit er einzelne Teile am Handy nachbessern kann.

**Vorschau-Knopf „Prompt prüfen“**: zeigt den finalen String vor dem Start (entspricht „Preview Prompt“ in DaSiWa).

**Prüfhilfe (nur Warnungen, kein Blockieren)**, gemäß den Regeln des Nutzers:
- Ist „Kein Dialog“ angehakt: Warnung, wenn `<d>`-Tags, `(S1)` o. Ä. im Text stehen oder wenn im Soundscape „no dialogue, no speech, no voices“ fehlt
- Bei Dialog: Warnung, wenn Text nicht im Format `(S1) <d>[English] …</d>` steht
- Ein Feld für den negativen Prompt gibt es **nicht** (Turbo, CFG 1, wirkungslos)

### Referenzbilder und Audio – erst untersuchen, dann bauen

Referenzbilder (bis 9) und Audio-Referenzen (bis 3) stecken im Director **nicht** als normale Inputs, sondern im JSON-String `2730.timeline_data` (Feld `items`, im Export leer) und teilweise in `builder_state`. Das Schema ist nicht dokumentiert. **Vorgehen:**

1. Den Nutzer bitten, in ComfyUI einen Director mit z. B. 2 Referenzbildern und 1 Audio-Datei zu befüllen und den Workflow erneut **im API-Format** zu exportieren
2. `timeline_data` und `builder_state` beider Exporte vergleichen und das Schema der `items` ableiten (Dateinamen, Typ Bild/Audio, Subject-Zuordnung, Zeitbereich)
3. Erst dann den Builder schreiben. Uploads: Datei per `/upload/image` hochladen (funktioniert auch für Audio), den zurückgegebenen Dateinamen ins Item eintragen
4. Zusätzlich im Quellcode von `ComfyUI-DaSiWa-Nodes` auf dem Pod nachsehen, wie `MiniMaxH3Director` `timeline_data` parst, falls der Vergleich nicht eindeutig ist

UI für Refs: Galerie mit Kacheln (Kamera/Fotos-Picker am Handy), pro Bild Auswahl, welchem Subject (1, 2, 3 …) es gehört. Audio: Datei-Picker, pro Datei Subject-Zuordnung (= Speaker-ID), mit Abspielknopf.

### Continuity-Nodes

`1512:2796` und `2797` (Continuity Append/Publish) unverändert im Workflow lassen. Weiterführende Clips aus einem Vorgänger sind **Phase 2**.

### Ausgabe

Das Video kommt aus `DaSiWa_EnhancedVideoCombine` (`2568`). Im History-Ergebnis steht es unter `outputs["2568"]` (Schlüssel `gifs` oder `videos`, beides prüfen). Im Browser mit `<video controls playsinline>` abspielen, Download-Knopf, „Mit gleichen Einstellungen nochmal“ und „Seed übernehmen“.

---

## Seiten und Navigation

Untere Tab-Leiste (Daumen-erreichbar): **Bild** · **Video** · **Warteschlange** · **Galerie** · **Einstellungen**

- **Bild**: Umschalter WAI / Pony / Anima oben, darunter Preset-Auswahl, Prompt, einklappbare Bereiche wie TensorHub (Modelle, Einstellungen, Erweiterte Einstellungen, Hochskalieren). Fester „Generieren“-Knopf unten, mit Anzahl der Jobs im Text („Generieren – 40 Bilder“)
- **Video**: H3-Einstellungen wie oben, Ref-Galerie, Audio, Prompt-Blöcke
- **Warteschlange**: laufender Job mit Fortschrittsbalken (Step x / y) und Live-Vorschaubild, falls vorhanden; wartende Jobs mit Löschen; Knopf „Alles abbrechen“ und „VRAM freigeben“
- **Galerie**: Outputs aus `/history` (neueste zuerst), Filter Bild/Video und nach Ordner. Tippen = Vollbild, Swipe, Download, „Einstellungen übernehmen“ (stellt das Formular aus den gespeicherten Job-Settings wieder her)
- **Einstellungen**: Verbindungsstatus zu ComfyUI, Standard-Ordner, Presets verwalten

Jeder abgeschickte Job speichert sein komplettes Settings-Objekt serverseitig unter seiner `prompt_id`, damit Galerie und „nochmal“ funktionieren.

## Fehlerbehandlung

- ComfyUI nicht erreichbar (z. B. noch am Starten oder abgestürzt) → klare Meldung „ComfyUI antwortet nicht“ mit Knopf „Erneut versuchen“
- `/prompt` liefert `node_errors` → lesbar anzeigen (welcher Node, welcher Wert), z. B. fehlende Modelldatei
- `execution_error` aus dem WebSocket → Fehlermeldung beim Job anzeigen, Batch läuft mit dem nächsten Block weiter
- Fehlt eine Node-Klasse (z. B. Inspire, Impact, DaSiWa nicht installiert) → betroffene Funktion ausgrauen statt abstürzen

## Reihenfolge der Umsetzung

1. Grundgerüst, Login, Verbindungstest, `/object_info`-Abfrage, Start-Skript und GitHub-Actions-Release (früh, damit von Anfang an echt auf dem Pod getestet wird)
2. WAI-Builder + Tests, Einzelprompt, Fortschritt, Ergebnisanzeige
3. Hochskalieren, LoRA-Kette, Presets, Batch-Prompts
4. Anima-Builder (Shift-Node testen)
5. Warteschlange und Galerie
6. H3: Einstellungen und Prompt-Blöcke ohne Refs, Testlauf
7. H3: Ref-Bilder und Audio nach der Schema-Untersuchung
8. PWA, Feinschliff für iPhone (Safe-Area, `playsinline`, große Touch-Ziele)
9. Phase 2: ADetailer, Continuity, Benachrichtigung wenn Batch fertig

Nach jedem Schritt mit einem echten Pod testen und dem Nutzer kurz zeigen, was geht. Nichts als fertig melden, was nicht gegen den Pod gelaufen ist.
