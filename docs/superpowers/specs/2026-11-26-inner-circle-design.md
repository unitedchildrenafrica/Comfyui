# Inner Circle – eigener Tab mit Mitglieder-Tabelle

Stand: 26.11.2026 · vom Nutzer freigegeben (Entwurf + Screenshots im Chat, „sonst bau bitte“)

## Warum

Der Nutzer pflegt seine Inner-Circle-Mitglieder (Patreon) bisher in einer Google-Tabelle
„Inner Circle Verwaltung“: Name, Discord, Stufe, Betrag, Beitritt, nächster Zahltag, Tage bis Zahlung
(Ampel), „proaktiv angeschrieben?“, „Antwort erhalten?“. Das soll in die App, als **eigener Tab ganz
links** in der unteren Leiste, **so übersichtlich wie die Tabelle**, aber mit Antippen statt Tippen und
mit automatisch gefüllten Patreon-Daten. Pro Mitglied und Monat will er festhalten: angeschrieben,
Antwort, **welches Set er will**, **ob er es schon hat**.

## Ziele

- Neuer Tab `/circle` („Circle“, 👑) als **erster** Eintrag der BottomNav.
- Tabelle mit einer Zeile pro Mitglied; Spalten:
  Mitglied · Discord · Bot · Stufe · $/Monat · Beitritt · Letzte Zahlung · Nächste Zahlung · Tage ·
  Angeschrieben · Antwort · Set gewünscht · Hat es
- **Automatisch aus Patreon** (bestehender Sync, `lib/server/patreon.ts`, stündlich + „↻ Patreon“):
  Name, Stufe, Betrag, Beitritt (`since`), letzte Zahlung + Status (✓ bezahlt / ✗ abgelehnt), nächste
  Zahlung, Abrechnungsintervall. Namen kommen von Patreon – kein Abgleich nötig.
- **Vom Nutzer gepflegt, bleibt dauerhaft:** Discord-Name, Bot-Name (Name seines Discord-Bots, optional),
  Notiz.
- **Pro Zahlung (Zyklus), per Antippen:** Angeschrieben / Antwort / Hat es (offen → ✓ Ja → ✗ Nein →
  offen), Set gewünscht (Freitext mit Vorschlägen). Neue Abbuchung ⇒ neuer Zyklus ⇒ alles wieder „offen“.
  Alte Zyklen bleiben als Verlauf.
- „Antwort ✓ Ja“ merkt sich das Datum (ersetzt die Tabellen-Spalte „Letzte Anfrage erhalten“).
- **Tage bis Zahlung** = nächste Zahlung − heute (Kalendertage, Zeitzone des Browsers).
  Farben: rot ≤ 7 (auch negativ = überfällig), orange 8–14, grün ≥ 15. Ohne Datum „–“.
- Kennzahlen oben: aktive Mitglieder, $ pro Monat, noch anschreiben, wartet auf Antwort, Set noch liefern.
- Filter-Chips mit Anzahl: Alle · Anschreiben · Wartet auf Antwort · Set liefern · Zahlt bald · Abgelehnt · Ehemalige.
- Suche über Name, E-Mail, Discord, Bot, Set.
- „＋ Mitglied“: Mitglieder ohne Patreon von Hand (Name, Discord, Bot, Stufe, $/Monat, Beitritt,
  letzte Zahlung, nächste Zahlung), bearbeitbar und löschbar.
- Name antippen ⇒ Detail-Blatt: E-Mail, Patreon-Profil-Link, Notiz, Verlauf der Zyklen
  (Monat: angeschrieben/Antwort/Set/hat es), bei Hand-Mitgliedern Felder bearbeiten + löschen.
- Handy: Namensspalte bleibt links stehen, Tabelle wischt seitlich. Auf schmalen Bildschirmen
  (< 640 px) Spaltenreihenfolge: Mitglied · Tage · Angeschrieben · Antwort · Set · Hat es · Discord · Bot ·
  Stufe · $ · Beitritt · Letzte · Nächste. Am Rechner Reihenfolge wie oben (wie die Google-Tabelle).

## Nicht-Ziele

- Nachrichten-Vorlagen (vom Nutzer abgelehnt), Nachrichten verschicken, Discord-API.
- Import aus der Google-Tabelle (Discord-Namen trägt der Nutzer selbst ein).
- Mehrbenutzer, Datenbank.

## Anti-Ziele

- Antippen darf nie hängen oder Daten verlieren (zwei schnelle Taps hintereinander, zwei Geräte).
- Ein Patreon-Ausfall darf die Tabelle nicht leeren: es gilt der letzte gespeicherte Stand.
- Patreon-Tokens/E-Mails nie in Logs oder Fehlermeldungen.

## Ansätze (besprochen)

- **A – Patreon füllt automatisch, Nutzer ergänzt per Tippen** ← gewählt.
- B – alles von Hand wie die Google-Tabelle (Zahltage weiter abtippen, Kündigungen unbemerkt).
- C – Google-Tabelle bleibt, App zeigt sie an (Google-Anbindung, am Handy fummelig).

## Daten

Neue Datei `DATA_DIR/inner-circle.json` (Schreibzugriffe in einer Warteschlange wie `setAcks`):

```ts
interface CircleStore {
  /** Schlüssel: Patreon-Member-ID oder „m_<zufall>“ für Hand-Mitglieder */
  people: Record<string, {
    discord?: string; bot?: string; note?: string;
    manual?: { name: string; tier?: string; cents?: number; since?: string | null;
               lastCharge?: string | null; nextCharge?: string | null; email?: string };
  }>;
  /** Zyklus-Felder: people-Schlüssel → Zyklus-ID → Werte */
  cycles: Record<string, Record<string, {
    contacted?: "yes" | "no"; answer?: "yes" | "no"; hasIt?: "yes" | "no";
    set?: string; answerAt?: number; updatedAt: number;
  }>>;
}
```

- **Zyklus-ID** = Datum (JJJJ-MM-TT) der letzten *bezahlten* Abbuchung; ohne bezahlte Abbuchung
  `"start"`. Hand-Mitglieder: Datum ihrer eingetragenen „letzten Zahlung“, sonst `"start"`.
  Abgelehnte Abbuchung beginnt keinen neuen Zyklus (Zyklus bleibt am letzten bezahlten Datum hängen;
  für „declined“ ist `lastCharge` das abgelehnte Datum – dann gilt der bisher jüngste Zyklus aus dem Store,
  sonst `"start"`).
- **Übernahme:** vorhandene `patreon-acks.json` (Member → abgehakte Abbuchung) wird beim ersten Laden
  zu `contacted: "yes"` im passenden Zyklus. `patreon-acks.json` bleibt unangetastet.
- Welche Patreon-Mitglieder erscheinen: wie bisher die gewählten Stufen (`patreon-settings.json`,
  Standard „Inner Circle“). Die Stufen-Chips stehen klein in einem einklappbaren „Stufen“-Bereich.

### Entscheidungen nach der Bauer-Prüfung (Calls von Claude)

- **Hand-Mitglieder haben keinen Patreon-Status.** Sie gelten als aktiv, bis im Detail-Blatt
  „Mitglied beendet“ angehakt wird (`manual.ended: true`) – dann „Ehemalig“. „Abgelehnt“ gibt es für
  sie nicht.
- **Zahltag eines Hand-Mitglieds verstreicht:** nichts passiert automatisch, die Zeile wird rot/negativ
  (überfällig). Im Detail-Blatt gibt es den Knopf **„Zahlung erhalten“**: setzt letzte Zahlung = heute und
  nächste Zahlung = heute + 1 Monat (bzw. + 12 bei jährlich, Feld „jährlich“ im Formular) – das ist ein
  neuer Zyklus. Die Daten lassen sich auch von Hand ändern; ein neues Datum = neuer Zyklus (gewollt).
- **Übertrag aus „start“:** Hat ein Mitglied Werte im Zyklus `"start"` und der erste datierte Zyklus ist
  noch leer, werden die `"start"`-Werte dorthin übernommen (gilt für Patreon-Erstzahlung und Hand-
  Mitglieder). So geht nichts verloren, wenn jemand vor der ersten Abbuchung schon bearbeitet wurde.
- **Letzte Abbuchung weder Paid noch Declined** (Pending, Refunded, Fraud …): Zyklus = jüngster bereits
  gespeicherter datierter Zyklus, sonst `"start"`; die Zeile zählt nicht als „Anschreiben“ (wie bisher
  „waiting“), steht aber in „Alle“ mit dem Patreon-Status als Hinweis.
- Alte Route `/api/patreon` bleibt für den Notizen-Zähler bestehen; Patreon-Sync wird von beiden geteilt.
- Zwei Geräte gleichzeitig: jede Änderung ist ein einzelnes Feld-Update auf dem Server (kein ganzes
  Objekt überschreiben); der Server liefert danach den vollen Stand zurück.

## Zustände und Filter

Pro Zeile (aktueller Zyklus):
- **Ehemalig:** Patreon `former_patron` oder kein Status → nur unter „Ehemalige“, nicht in „Alle“.
- **Abgelehnt:** `declined_patron` oder letzte Abbuchung „Declined“.
- **Anschreiben:** aktiv, letzte Abbuchung bezahlt, `contacted` ≠ yes.
- **Wartet auf Antwort:** `contacted` = yes, `answer` ≠ yes.
- **Set liefern:** `set` nicht leer, `hasIt` ≠ yes.
- **Zahlt bald:** Tage 0–7.
- **Alle:** alle außer Ehemalige. Sortierung: Anschreiben zuerst, dann nach Tagen aufsteigend.

Kennzahlen: aktive = nicht ehemalig und nicht abgelehnt; $/Monat = Summe der Beträge aktiver
Mitglieder, jährliche Zahler (Intervall 12) durch 12 geteilt.

## Technik

- API `app/api/circle/route.ts`: `GET` → Stand (Patreon-Snapshot + Store zusammengeführt, fertig berechnete
  Zeilen außer „Tage“, die der Browser rechnet); `POST` mit Aktionen: `sync`, `cycle` (key, cycleId, Feld,
  Wert), `person` (key, discord/bot/note), `add`/`edit`/`remove` (Hand-Mitglied), `tiers`.
  Jede Antwort liefert den neuen Stand.
- Reine Logik (Zyklus-ID, Zustände, Filter, Kennzahlen, Tage, Übernahme der Acks) in `lib/circle.ts`
  mit Unit-Tests; Speicher in `lib/server/circle.ts`.
- Antippen: sofort im Browser umschalten (optimistisch), dann speichern; bei Fehler zurück + Meldung.
- Set-Vorschläge: Galerie-Ordner (`/api/zip?list=1`) plus bisher eingetragene Sets.
- Notizen-Panel: Reiter „Inner Circle“ zeigt nur noch die Zahl „anschreiben“ und einen Link
  „Zum Tab Circle →“ (die alte Liste entfällt; „hat gezahlt – anschreiben“ = Filter „Anschreiben“).
- Patreon nicht eingerichtet: Tab zeigt Hand-Mitglieder und den bisherigen Einrichtungs-Hinweis.
- Test lokal mit `dev/mock-patreon.mjs`.

## Dem Bauer überlassen

Genaue Optik (an Entwurf und App-Stil anlehnen), Komponenten-Aufteilung, wie das Set-Feld editiert
wird (Inline-Eingabe oder kleines Blatt), Wortlaut von Hinweisen.
