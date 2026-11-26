# Inner Circle – Discord-Namen automatisch

Stand: 26.11.2026 · Nutzer hat den Vorschlag im Chat freigegeben (Token geschickt = „ja, bauen“).

## Warum
Discord-Namen sollen nicht mehr von Hand in die Inner-Circle-Tabelle getippt werden müssen.

## Ansatz (Klein)
1. Patreon-Abgleich fragt zusätzlich `fields[user]=social_connections` ab; `social_connections.discord.user_id`
   wird als `discordId` am Mitglied gespeichert (nur wenn das Mitglied Discord bei Patreon verbunden hat).
2. `lib/server/discord.ts`: holt zu diesen IDs per Discord-API (`GET /api/v10/users/{id}`,
   `Authorization: Bot <DISCORD_BOT_TOKEN>`) den Benutzernamen; Zwischenspeicher `DATA_DIR/discord-names.json`,
   je ID höchstens alle 24 h neu, höchstens 50 Abfragen pro Durchlauf, bei 429/401 abbrechen.
   Fehlermeldungen enthalten nie den Token. Basis-URL per `DISCORD_API_BASE` (Tests).
3. Tabelle: Discord-Spalte = selbst eingetragener Name, sonst automatisch geholter (mit 🔗 markiert).
   Selbst eingetragen gewinnt immer; leeren → automatischer Name kommt zurück.
4. `GET /api/circle` stößt nach dem Patreon-Abgleich das Nachholen an (höchstens ~8 s warten).
5. Einrichtung: `bash /root/setup-server.sh discord` fragt den Bot-Token verdeckt ab, speichert
   `DISCORD_BOT_TOKEN` in der Server-Umgebung, startet die App neu. Token nie im Repo, Chat oder Browser.

Alternativen verworfen: Discord-Server-Mitgliederliste per Bot (braucht Einladung + Rechte, Zuordnung zu
Patreon unsicher); Patreon-Discord-Integration auslesen (keine öffentliche API).

## Nicht-Ziele
Discord-Nachrichten senden, Rollen, Server-Mitgliedschaft.

## Tests
Patreon-Mock liefert `social_connections` → `discordId`; Discord-Mock: Name gespeichert, 404 vermerkt,
401 → Fehler ohne Token, 24-h-Cache; `buildRows`: eigener Name gewinnt, sonst Auto-Name mit Markierung.
