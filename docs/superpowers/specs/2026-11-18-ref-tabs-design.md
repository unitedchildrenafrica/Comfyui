# Ref-Tabs für H3 (Video) – Kurz-Design

## Warum
Über Nacht lange Video-Batches mit vielen Szenen-/Personenwechseln laufen lassen, ohne daneben zu
sitzen. Ein Ref-Tab ist ein komplettes Referenz-Paket (mehrere Personen, Setting): Bilder, Videos
und Audios/Stimmen.

## Ziele
- 5 Ref-Tabs, mit „+“ bis 10. Jeder Tab hat eigene Bilder, Videos, Audios (wie die heutige Liste).
- Batch: erste Zeile eines Clips „Ref-Tab 3“ (auch „Reftab 3“, „Ref 3“, Groß/klein egal) wählt den
  Tab; Clip-Name („Clip 35“) steht darunter. Ohne Zeile gilt der im Formular gewählte Tab.
- Einzelnes Video nutzt den gewählten Tab.
- Tabs liegen auf dem Server (Handy und Laptop gleich, überleben Pod-Wechsel).
- Bisherige Referenzliste wird zu Tab 1.

## Nicht-Ziele
- LoRAs oder andere Einstellungen pro Tab (bleiben für den ganzen Batch gleich).
- Tabs umbenennen.

## Ansätze
1. **Tabs auf dem Server, Formular schickt beim Start alle Tabs mit (gewählt).** Der Batch-Parser
   ordnet jedem Clip die Refs seines Tabs zu; jeder Job speichert die tatsächlich benutzten Refs.
2. Server liest Tabs beim Start selbst aus seiner Datei – Risiko, dass eine gerade gemachte Änderung
   noch nicht gespeichert ist.
3. Tabs nur im Browser – nicht zwischen Handy und Laptop geteilt; vom Nutzer nicht gewollt.

## Entscheidungen (meine Calls)
- Tag-Prüfung pro Clip: `<Picture n>`, `<Video n>`, `<Audio n>` im Prompt gegen den Tab; Warnung, kein Blockieren.
- Nicht vorhandener Tab oder Tab über den H3-Grenzen (9 Bilder, 3 Videos, 3 Tonspuren, 12 gesamt) → Fehler vor dem Start.
- „Einstellungen übernehmen“ aus einem Job: gleicher Inhalt wie ein Tab → diesen wählen; sonst in einen
  leeren/neuen Tab legen, nie einen bestehenden überschreiben.
- Speichern: Datei `DATA_DIR/ref-tabs.json`, letzte Änderung gewinnt (Einzelnutzer).
