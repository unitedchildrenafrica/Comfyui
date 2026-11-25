# Krea 2 Turbo im Portal – Entscheidungen und Bauplan

Stand: 2026-11-25. Ergänzt CLAUDE.md. Krea 2 kommt als **vierte Option im Bild-Umschalter**
(WAI / Pony / Anima / Krea 2), kein eigener Tab.

**Workflow:** `workflows/workflow_KREA2_Turbo.json` ist **von Hand aus dem offiziellen Template**
`image_krea2_turbo_t2i.json` (Comfy-Org/workflow_templates) übertragen, nicht vom Pod exportiert:
Subgraph aufgelöst, Prompt-Verbesserung (TextGenerate), Schalter und Stil-LoRA weggelassen,
Hires-Nodes im Layout der TensorHub-Templates ergänzt. Der erste Lauf auf dem Pod ist damit
auch die Probe für die Widget-Namen (`weight_dtype`, `device`). Die Prompt-Verbesserung des
Templates läuft lokal mit dem Text-Encoder – Kandidat für eine spätere Prompt-Hilfe ohne API.

---

## 1. Modell in Kürze

- 12B-DiT, Turbo = 8-Step-distilliert. Text-Encoder Qwen3-VL-4B → Prompts als **ganze englische Sätze**.
- Kein Negativ-Prompt (CFG 1). VAE `qwen_image_vae` (wie Anima).
- Feste Sampling-Werte (nur unter „Erweitert“ sichtbar): 8 Steps, CFG 1.0, euler, simple, Denoise 1.0.
- **Sampling-Shift:** nicht anzeigen, Template-Standard bleibt.

## 2. Builder `lib/builders/krea2.ts`

- Reine Funktion `buildWorkflow(input, opts) → apiJson`, wie WAI/Anima.
- **Feste Node-IDs** aus dem Export, keine Suche über `class_type`. Tests in `tests/builders.test.ts`
  (jede Referenz `[id, slot]` zeigt auf eine existierende Node).
- Positiver Prompt-Node = der Node, auf den `KSampler.positive` zeigt (beim Schreiben des Builders
  einmal bestimmen und als Konstante festhalten, Test prüft es).
- Negativ-Zweig bleibt, wie er im Template verdrahtet ist (`ConditioningZeroOut` o. ä.).
- Wird die JSON neu exportiert, ändern sich evtl. die IDs → Tests schlagen an, Konstanten nachziehen.

### Modelle (drei Dropdowns, live aus `/object_info`)

| Dropdown | Quelle | Vorauswahl |
|---|---|---|
| UNet | `UNETLoader.unet_name` | `krea2_turbo_fp8_scaled.safetensors` |
| Text-Encoder | `CLIPLoader.clip_name` (`type` = `krea2`) | `qwen3vl_4b_fp8_scaled.safetensors` |
| VAE | `VAELoader.vae_name` | `qwen_image_vae.safetensors` |

Vor dem Start prüfen (klare Meldung statt Absturz):
- Gewählte Datei steht nicht in der jeweiligen Liste → „Datei fehlt auf dem Pod: …“
- `CLIPLoader.type` enthält kein `krea2` → „ComfyUI auf dem Pod zu alt für Krea 2 – bitte updaten“
- `system.argv` aus `/system_stats` enthält `--use-sage-attention` oder `--fast` → **Warnung**
  „Mit diesen Startparametern liefert Krea 2 schwarze Bilder. ComfyUI ohne sie starten
  (`bash /workspace/start_comfy.sh bild`).“ Kein Blockieren, kein Schwarzbild-Erkenner.
- Server-Modus: alle Prüfungen gegen den **Bild-Pod** (`withRole("bild")`).

### Auflösung

| Preset | Größe |
|---|---|
| Hochformat (Standard) | 896 × 1152 |
| Hochformat schmal | 832 × 1216 |
| Quadrat | 1024 × 1024 |
| Querformat | 1152 × 896 |
| Querformat breit | 1216 × 832 |
| Custom | B/H auf **Vielfache von 16** runden |

### Weitere Funktionen in v1

- Anzahl Bilder 1–4: ja
- Hires/Hochskalieren: ja. Die Nodes `40`, `41`, `11`–`14` stecken wie bei WAI/Anima schon im
  Template, `applyUpscale` wird wiederverwendet (Lanczos ohne Modell wie bei WAI).
  - Standardwerte für den zweiten Durchgang: 4 Schritte, CFG 1, Denoise 0.3, euler/simple,
    Faktor 1.5x, Hochskalierer 4x_foolhardy_Remacri. Gegen den Pod prüfen, ggf. anpassen.
  - Zielgröße auf **Vielfache von 16** runden (nicht 8 wie bei WAI/Anima).
- ADetailer: nein (Schalter im Krea-Modus ausblenden)
- Clip Skip: nein

## 3. LoRAs

- Kette aus **`LoraLoaderModelOnly`** zwischen UNet und KSampler (nur `model`).
  Achtung: `insertLoraChain` in `lib/builders/hires.ts` baut `LoraLoader` mit model+clip →
  eigene Funktion oder Parameter für „nur Modell“.
- Neue LoRA-Klasse **`krea2`** in `lib/loraKinds.ts`:
  - Im Krea-Modus nur Krea-LoRAs anzeigen, alle anderen ausblenden. Im WAI/Pony/Anima-Modus
    Krea-LoRAs ausblenden. Noch **nicht zugeordnete** LoRAs stehen wie bisher in allen Listen
    (Hinweis mit Link „Sortieren“), „Bild + Video“ gilt nicht für Krea 2.
  - Automatische Erkennung: Dateiname enthält `krea` → `krea2`.
  - `guessUseFromBaseModel` und `civitaiType` (`lib/modelLinks.ts`) kennen „krea“
    (Krea-„Checkpoints“ von Civitai → `diffusion_models`).
  - Seite „Modelle“: Zuordnungs-Auswahl und Filter um „Krea 2“ ergänzen.
  - Krea-LoRAs aus `setup.sh` in eine eigene Liste `SETUP_KREA_LORAS` (nicht in
    `SETUP_IMAGE_LORAS`), Test in `tests/loraKinds.test.ts` entsprechend erweitern.
- Vorbelegung:

| Anzeigename | Datei | Standard | Bereich |
|---|---|---|---|
| NSFW AIO | `krea2_aio_nsfw.safetensors` | 0.8 | 0–1.5 |
| NSFW v2 | `krea2_nsfw_v2.safetensors` | 0.8 | 0–1.5 |
| Turbo NSFW | `krea2_turbo_nsfw.safetensors` | 1.0 | 0–1.5 |

  Jede Vorbelegung nur anzeigen, wenn die Datei auf dem Pod liegt (AIO hat noch keinen Download).
- Hinweise im UI: „Nur LoRAs, die für Krea 2 trainiert sind“ und „Bei mehreren LoRAs Stärken
  senken (Summe ≤ 1.5)“ – Warnung, wenn die Summe der aktiven Stärken > 1.5.

## 4. Prompts

- Kein Negativ-Feld im Krea-Modus.
- **Keine LLM-Prompt-Hilfe und keine Prompt-Warnungen in v1.**
- Batch: gleiches Format wie WAI (`positive:` / `name:` / `---`). `negative:`-Zeilen werden
  **ignoriert** und einmal als Hinweis angezeigt („Negativ-Prompts werden bei Krea 2 ignoriert“),
  kein Fehler. Jeder Block ein eigener `/prompt`-Job, alle sofort serverseitig eingereiht.
- Ausgabeordner Standard `krea2`, `filename_prefix` = `krea2/<name>`.

## 5. Anzupassende Stellen im Bestand

- `lib/types.ts`: `ImageGenerator` um `"krea2"`.
- `app/api/generate/image/route.ts:12`: Generator-Prüfung.
- `lib/server/submit.ts`: Builder-Auswahl, Vorab-Prüfungen aus Abschnitt 2.
- `lib/server/options.ts`: `CLIPLoader`-Typen (`type`) und `LoraLoaderModelOnly` mitladen,
  `system.argv`-Warnung bereitstellen.
- `lib/server/store.ts`: `folders` um `krea2: "krea2"`.
- `lib/defaults.ts`: Krea-Standardwerte.
- `app/bild/ImageForm.tsx`: Umschalter, Preset-Filter (bisher `anima` / nicht-`anima` → pro
  Generator-Familie: WAI+Pony gemeinsam, Anima, Krea 2), Felder ein-/ausblenden.
- `lib/server/notes.ts:148`, `components/notes/Characters.tsx`: Generator `krea2` zulassen.
- Galerie „Einstellungen übernehmen“ / „nochmal“: Krea-Jobs korrekt wiederherstellen.
- `lib/loraKinds.ts`, `lib/modelLinks.ts`, `app/modelle/page.tsx`: siehe Abschnitt 3.

## 6. Pod-Setup (`pod/setup.sh`)

- **ComfyUI-Update auch bei `bilder`** (`git reset --hard origin/master` wie bei `video`).
  Frontend bleibt `1.53.6`. Danach WAI und Anima einmal gegen den Pod testen.
- Krea-Dateien bei `bilder` laden (UNet, Text-Encoder, VAE ist schon da) + LoRAs
  `krea2_nsfw_v2` (Version 3065362) und `krea2_turbo_nsfw` (Version 3081369) über `$CIVITAI_TOKEN`.
- Speicherbedarf für `bilder` erhöhen (Vorschlag: +20 GB, die drei Dateien sind zusammen ca. 17 GB).
- `HF_TOKEN` bleibt **optional** bei `bilder`. Das Repo Comfy-Org/Krea-2 ist öffentlich (lädt ohne
  Token); ist er gesetzt, wird er mitgeschickt. Tokens gehören ins Pod-Template, **nie ins Repo**.
- CHECKS-Block: `CLIPLoader`-Typ `krea2` prüfen und melden.
- Krea-Dateien in „Modelle laden“ / `model-links` aufnehmen, damit sie auf frischen Pods per
  Tipp nachladbar sind.

## 7. Entschieden (2026-11-25)

- Hires: Nodes im Template (gleiche IDs wie WAI/Anima), Werte siehe Abschnitt 2.
- `HF_TOKEN`: optional, nur für die Krea-Downloads genutzt.
- Prompt-Warnungen: keine.

---

## Test-Checkliste (auf dem Bilder-Pod)

1. `bash setup.sh bilder` läuft durch; CHECKS meldet `krea2`-Typ OK; Log zeigt aktuellen ComfyUI-Commit.
2. WAI: ein Bild mit Standardwerten + Hires → kommt an.
3. Anima: ein Bild mit Standardwerten + Shift → kommt an.
4. Krea 2 mit Standardwerten (896×1152, keine LoRA) → Bild kommt an, nicht schwarz.
5. Krea 2 mit `Anzahl Bilder = 4` und Custom-Auflösung (z. B. 1000×1000 → wird 1008×1008).
6. Krea 2 mit Hires 1.5x → Zielgröße stimmt, Bild sieht sauber aus.
7. LoRA-Panel: nur Krea-LoRAs sichtbar; zwei LoRAs an → Warnung bei Summe > 1.5; an/aus und
   Stärke ändern das Ergebnis.
8. Im WAI-Modus tauchen keine Krea-LoRAs auf.
9. Falsche Datei vorwählen (UNet umbenennen oder anderes wählen) → „Datei fehlt“ vor dem Start.
10. ComfyUI mit `bash /workspace/start_comfy.sh bild sage` starten → Warnung zu den Startparametern.
11. Batch mit 3 Blöcken, einer davon mit `negative:` → Hinweis, 3 Jobs, „3 / 3 fertig“.
12. Galerie: Krea-Bild → „Einstellungen übernehmen“ stellt Krea-Formular inkl. LoRAs wieder her.
13. H3-Video einmal starten (auf `alles`-Pod oder Video-Pod) → läuft unverändert.
