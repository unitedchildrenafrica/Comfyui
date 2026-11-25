# Inner Circle Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eigener Tab `/circle` (ganz links) mit einer Tabelle aller Inner-Circle-Mitglieder: Patreon-Daten automatisch, Discord/Bot/Notiz und pro Zahlung Angeschrieben/Antwort/Set/Hat es per Antippen.

**Architecture:** Reine Logik in `lib/circle.ts` (Zyklen, Zustände, Filter, Kennzahlen, Tage) verbindet den vorhandenen Patreon-Snapshot (`lib/server/patreon.ts`) mit einem neuen Speicher `DATA_DIR/inner-circle.json` (`lib/server/circle.ts`). API `app/api/circle/route.ts` liefert fertige Zeilen und nimmt Feld-Updates an. Seite `app/circle/page.tsx` zeigt Kennzahlen, Filter, Suche und die Tabelle.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-inner-circle-design.md`

## Global Constraints

- Tab: `href "/circle"`, Label `"Circle"`, Icon `"👑"`, **erster** Eintrag in `components/BottomNav.tsx`.
- Speicher: `DATA_DIR/inner-circle.json`, Schreiben über eine Warteschlange (Muster `setAcks` in `lib/server/patreon.ts`); `patreon-acks.json` nur lesen.
- Tage-Farben: rot ≤ 7 (auch negativ), orange 8–14, grün ≥ 15, ohne Datum „–“.
- Antippen-Reihenfolge für Ja/Nein-Felder: offen → `"yes"` → `"no"` → offen.
- Spaltenreihenfolge Rechner: Mitglied · Discord · Bot · Stufe · $/Monat · Beitritt · Letzte Zahlung · Nächste Zahlung · Tage · Angeschrieben · Antwort · Set gewünscht · Hat es. Unter 640 px: Mitglied · Tage · Angeschrieben · Antwort · Set gewünscht · Hat es · Discord · Bot · Stufe · $/Monat · Beitritt · Letzte · Nächste.
- Keine Nachrichten-Vorlagen, kein Google-Import, kein Discord-API.
- E-Mails/Tokens nie in Fehlermeldungen oder Logs.

## Review Focus

- Zwei schnelle Taps auf dieselbe Zelle (oder zwei Geräte) → beide Updates landen, keins überschreibt das andere (Feld-Updates einzeln, Warteschlange). Test in Task 2.
- Patreon nicht erreichbar / nie eingerichtet → Tabelle zeigt letzten Snapshot bzw. nur Hand-Mitglieder, kein Absturz. Test in Task 2 (`circleView` ohne Snapshot).
- Mitglied zahlt neu → Zeile springt auf „offen“, alter Monat steht im Verlauf; Werte aus `"start"` gehen beim ersten Zahltag nicht verloren. Test in Task 1.
- Jährlicher Zahler → $/Monat zählt Betrag/12, Tage zeigen bis zu 365. Test in Task 1.
- Ungültige Eingaben an die API (unbekannter key, Feld, überlange Texte) → 400, Speicher unverändert. Test in Task 2.

---

### Task 1: Reine Logik `lib/circle.ts`

**Files:**
- Create: `lib/circle.ts`
- Test: `tests/circle.test.ts`

**Interfaces:**
- Consumes: `PatreonMember`, `PatreonTier`, `isPaid` aus `lib/patreon.ts`.
- Produces:
  - `type Tri = "yes" | "no"`; `nextTri(v: Tri | undefined): Tri | undefined`
  - `interface CycleData { contacted?: Tri; answer?: Tri; hasIt?: Tri; set?: string; answerAt?: number; updatedAt: number }`
  - `interface ManualMember { name: string; tier?: string; cents?: number; yearly?: boolean; since?: string | null; lastCharge?: string | null; nextCharge?: string | null; email?: string; ended?: boolean }`
  - `interface PersonExtra { discord?: string; bot?: string; note?: string; manual?: ManualMember }`
  - `interface CircleStore { people: Record<string, PersonExtra>; cycles: Record<string, Record<string, CycleData>>; acksMigrated?: boolean }`
  - `type RowState = "former" | "declined" | "contact" | "waiting" | "active"`
  - `interface CircleRow { key: string; source: "patreon" | "manual"; name: string; email: string; url: string | null; tier: string; cents: number; monthlyCents: number; yearly: boolean; since: string | null; lastCharge: string | null; lastChargeStatus: string | null; nextCharge: string | null; state: RowState; cycleId: string; cycle: CycleData; history: { cycleId: string; data: CycleData }[]; discord: string; bot: string; note: string; manual: ManualMember | null }`
  - `cycleIdFor(lastCharge: string | null, lastChargeStatus: string | null, storedIds: string[]): string` – `"YYYY-MM-DD"` der letzten bezahlten Abbuchung; sonst jüngste gespeicherte datierte ID ≤ lastCharge; sonst `"start"`. Hand-Mitglieder rufen es mit Status `"Paid"` auf.
  - `currentCycle(store: CircleStore, key: string, cycleId: string): CycleData` – mit Übertrag aus `"start"`, wenn der datierte Zyklus fehlt.
  - `buildRows(snap: { tiers: PatreonTier[]; members: PatreonMember[] } | null, tracked: string[] | null, store: CircleStore): CircleRow[]` – Patreon-Mitglieder der gewählten Stufen + Hand-Mitglieder; Sortierung: contact zuerst, dann nach nächster Zahlung aufsteigend, Name.
  - `daysUntil(iso: string | null, now: Date): number | null` (Kalendertage, lokale Zeitzone)
  - `dayTone(d: number | null): "red" | "orange" | "green" | null`
  - `type CircleFilter = "all" | "contact" | "answer" | "deliver" | "soon" | "declined" | "former"`
  - `matchesFilter(r: CircleRow, f: CircleFilter, now: Date): boolean`
  - `circleStats(rows: CircleRow[]): { active: number; monthlyCents: number; toContact: number; waitingAnswer: number; toDeliver: number }`
  - `migrateAcks(store: CircleStore, acks: Record<string, string>): CircleStore` – setzt `contacted: "yes"` im Zyklus `cycleIdFor(charge,"Paid",[])`, setzt `acksMigrated: true`, nur einmal.

- [ ] **Step 1: Write the failing tests** (`tests/circle.test.ts`)
  - `nextTri`: `undefined → "yes" → "no" → undefined`.
  - `cycleIdFor("2026-11-12T08:00:00+00:00","Paid",[])` → `"2026-11-12"`; `cycleIdFor("2026-11-28T…","Declined",["2026-10-28"])` → `"2026-10-28"`; `cycleIdFor("2026-11-28T…","Pending",[])` → `"start"`; `cycleIdFor(null,null,[])` → `"start"`.
  - `currentCycle`: Store mit `cycles.k.start = {set:"Bombchu", contacted:"yes"}` und ID `"2026-11-12"` ohne Eintrag → liefert `set "Bombchu"`, `contacted "yes"`; existiert `"2026-11-12"` schon → liefert dessen Werte.
  - `buildRows`: Mitglied mit Abbuchung 12.11. bezahlt und Store-Zyklus `"2026-10-12"` (`contacted yes`) → Zeile `state "contact"`, `cycle` leer, `history[0].cycleId "2026-10-12"`. Gleiches Mitglied mit `contacted yes` im aktuellen Zyklus → `state "active"`.
  - `buildRows`: `former_patron` → `"former"`; `declined_patron` → `"declined"`; Stufe nicht in `tracked` → nicht enthalten; Hand-Mitglied ohne `ended` → `"active"`/`"contact"` nach Zyklus, mit `ended: true` → `"former"`.
  - `monthlyCents`: Patreon `cadence 12`, `cents 52800` → `4400`; monatlich `4400` → `4400`; Hand-Mitglied: `cents` ist schon der Monatsbetrag (Formularfeld „$/Monat“), `yearly` ändert ihn nicht.
  - `daysUntil("2026-12-12T…", new Date(2026,10,26,23,0))` → `16`; vergangenes Datum → negativ; `null` → `null`.
  - `dayTone`: `-3→"red"`, `7→"red"`, `8→"orange"`, `14→"orange"`, `15→"green"`, `null→null`.
  - `matchesFilter`: `answer` = contacted yes & answer ≠ yes; `deliver` = set nicht leer & hasIt ≠ yes; `soon` = Tage 0–7; `all` schließt `former` aus.
  - `circleStats` auf drei Zeilen (aktiv, declined, former) → `active 1`.
  - `migrateAcks` zweimal aufgerufen → Ergebnis gleich, `acksMigrated true`.

- [ ] **Step 2: Run** `npx vitest run tests/circle.test.ts` → FAIL (Modul fehlt).
- [ ] **Step 3: Implement `lib/circle.ts`** nach den Signaturen oben. `answerAt` wird nicht hier, sondern beim Speichern gesetzt (Task 2).
- [ ] **Step 4: Run** `npx vitest run tests/circle.test.ts` → PASS; `npx tsc --noEmit` ohne Fehler.
- [ ] **Step 5: Commit** `feat: Inner Circle – Logik für Zyklen, Zustände, Filter`

### Task 2: Speicher und API

**Files:**
- Create: `lib/server/circle.ts`, `app/api/circle/route.ts`
- Test: `tests/circleStore.test.ts`

**Interfaces:**
- Consumes: Task 1; `getSnapshot`, `getTrackedTiers`, `setTrackedTiers`, `getAcks`, `syncPatreon`, `patreonConfigured`, `patreonError`, `startPatreonLoop` aus `lib/server/patreon.ts`.
- Produces:
  - `getStore(): Promise<CircleStore>`
  - `updateStore(fn: (s: CircleStore) => void): Promise<CircleStore>` (Warteschlange, atomar schreiben `tmp`+`rename`)
  - `interface CircleView { configured: boolean; syncedAt: number | null; error: string | null; tiers: PatreonTier[]; trackedTiers: string[] | null; rows: CircleRow[] }`
  - `circleView(): Promise<CircleView>` – migriert Acks beim ersten Mal.
  - `setCycleField(key: string, cycleId: string, field: "contacted" | "answer" | "hasIt" | "set", value: Tri | string | null): Promise<void>` – `answer → "yes"` setzt `answerAt = Date.now()`; `set` max. 200 Zeichen, getrimmt; `null` löscht das Feld.
  - `setPersonField(key: string, field: "discord" | "bot" | "note", value: string): Promise<void>` – discord/bot max. 100, note max. 2000.
  - `addManual(m: ManualMember): Promise<string>` (key `"m_"+12 Zeichen`), `editManual(key, patch: Partial<ManualMember>)`, `removeManual(key)` (löscht people + cycles), `paidManual(key, today: string)` → lastCharge=today, nextCharge=today+1 Monat (bzw. +12 bei `yearly`).
  - `class CircleError extends Error` für Eingabefehler.
  - Route: `GET /api/circle` → `CircleView` (wie `/api/patreon`: Loop starten, Sync wenn Snapshot fehlt oder > 60 min alt, Fehler ignorieren). `POST` mit `{ action: "sync" | "cycle" | "person" | "add" | "edit" | "remove" | "paid" | "tiers", … }` → neue `CircleView`; `CircleError` → 400.
  - `key` gültig = Patreon-Member im Snapshot oder vorhandenes Hand-Mitglied; sonst `CircleError("Unbekanntes Mitglied")`.

- [ ] **Step 1: Write the failing tests** (`tests/circleStore.test.ts`, `DATA_DIR` = Temp-Ordner, `patreon-members.json` mit 2 Mitgliedern und `patreon-acks.json` vorab schreiben)
  - `circleView()` → zwei Zeilen; das Mitglied mit Ack hat `cycle.contacted "yes"`; zweiter Aufruf ändert nichts.
  - `Promise.all([setCycleField(k,c,"contacted","yes"), setCycleField(k,c,"set","Bombchu 200"), setPersonField(k,"discord",".agnikai")])` → alle drei Werte im Store.
  - `setCycleField(k,c,"answer","yes")` → `answerAt` gesetzt.
  - `setCycleField("gibtsnicht",…)` → wirft `CircleError`; `setPersonField(k,"discord","x".repeat(101))` → wirft.
  - `addManual({name:"Falcon",cents:4400,yearly:true,lastCharge:"2025-06-15",nextCharge:"2027-06-15"})` → Zeile `source "manual"`, `monthlyCents 4400`; `paidManual(key,"2026-11-26")` → `nextCharge "2027-11-26"`, neuer `cycleId "2026-11-26"`; `removeManual` → Zeile weg.
  - Ohne `patreon-members.json`: `circleView().rows` enthält nur Hand-Mitglieder, kein Fehler.
- [ ] **Step 2: Run** `npx vitest run tests/circleStore.test.ts` → FAIL.
- [ ] **Step 3: Implement** `lib/server/circle.ts` und `app/api/circle/route.ts`.
- [ ] **Step 4: Run** Tests → PASS, `npx tsc --noEmit` ok.
- [ ] **Step 5: Commit** `feat: Inner Circle – Speicher und API`

### Task 3: Seite, Tab, Notizen-Verweis

**Files:**
- Create: `app/circle/page.tsx` (Seite), `app/circle/CircleTable.tsx` (Tabelle + Zellen), `app/circle/MemberSheet.tsx` (Detail-Blatt + Formular Hand-Mitglied)
- Modify: `components/BottomNav.tsx` (erster Eintrag), `components/notes/NotesPanel.tsx` (Reiter „Inner Circle“ → Zahl + Link `/circle`), `README.md` (kurzer Abschnitt)

**Interfaces:**
- Consumes: `GET/POST /api/circle` (Task 2), `CircleRow`, `CircleFilter`, `matchesFilter`, `circleStats`, `daysUntil`, `dayTone`, `nextTri` (Task 1); `/api/zip?list=1` → `{ folders: string[] }` für Set-Vorschläge.
- Produces: Seite `/circle`.

- [ ] **Step 1: Implement die Seite** nach Entwurf (`scratchpad`-Screenshots im Chat): Kopf „👑 Inner Circle“ + Stand + „↻ Patreon“; 5 Kennzahl-Karten; Filter-Chips mit Anzahl; Suche (Name, E-Mail, Discord, Bot, Set); „＋ Mitglied“; Tabelle mit fester Namensspalte (`position: sticky; left: 0`), horizontal wischbar, Spaltenreihenfolge laut Global Constraints (unter 640 px per `matchMedia`); Ja/Nein-Zellen schalten per `nextTri` optimistisch und rufen `POST {action:"cycle"}`; Discord/Bot/Set per Inline-Eingabe (Enter/Blur speichert, Set mit `<datalist>` aus Galerie-Ordnern + bisherigen Sets); Namen antippen öffnet `MemberSheet` (E-Mail, Profil-Link, Notiz, Verlauf, bei Hand-Mitgliedern Formular + „Zahlung erhalten“ + „Mitglied beendet“ + Löschen); Stufen-Auswahl einklappbar; Patreon nicht eingerichtet → Hinweis mit `bash /root/setup-server.sh patreon`.
- [ ] **Step 2: BottomNav** `{ href: "/circle", label: "Circle", icon: "👑" }` an erste Stelle; NotesPanel-Reiter zeigt „N anschreiben – Zum Tab Circle →“ statt der alten Liste.
- [ ] **Step 3: Verify** mit `node dev/mock-patreon.mjs` + `PATREON_API_BASE=http://127.0.0.1:18880 PATREON_ACCESS_TOKEN=mock-token`: Playwright 1440×900 und 390×844 – Zeilen aus dem Mock sichtbar, Antippen „Angeschrieben“ → nach Neuladen „✓ Ja“, Discord eintragen → bleibt, Filter „Anschreiben“ zählt richtig, Hand-Mitglied anlegen → erscheint. Keine `pageerror`.
- [ ] **Step 4: Gesamtprüfung** `npx tsc --noEmit`, `npx vitest run`, `npx next build` – alles grün.
- [ ] **Step 5: Commit** `feat: Tab Inner Circle mit Mitglieder-Tabelle`, dann laut CLAUDE.md `origin/main` hereinmergen und auf `main` pushen.
