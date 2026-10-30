#!/usr/bin/env bash
# Einrichtung des eigenen Servers (z. B. one.com Cloud Server, Ubuntu 24.04) für den Server-Modus:
# Die App läuft hier dauerhaft unter https://comfy.comfyusel.uk, der GPU-Pod meldet sich an und
# rechnet nur. Fertige Bilder/Videos werden automatisch hierher kopiert.
#
#   bash setup-server.sh          einrichten bzw. aktualisieren (mehrfach ausführen ist ok)
#
# Beim ersten Lauf (als root) werden abgefragt bzw. aus der Umgebung übernommen:
#   GH_TOKEN         Read-only-Token für das private Repo (Release-Download)
#   APP_PASSWORD     Login-Passwort der App
#   CF_TUNNEL_TOKEN  Token des bestehenden Tunnels für comfy.comfyusel.uk
# Alles landet in /etc/pod-frontend.env (nur für root lesbar). POD_SECRET und SESSION_SECRET
# werden einmalig erzeugt. Läuft mit systemd: startet beim Booten, Neustart bei Absturz.
set -euo pipefail

GH_REPO="${GH_REPO:-unitedchildrenafrica/Comfyui}"
APP_DIR=/opt/pod-frontend
BASE=/srv/pod-frontend
ENV_FILE=/etc/pod-frontend.env
CURL_NET=(--retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 20)
log() { echo "[server] $(date '+%H:%M:%S') $*"; }

[ "$(id -u)" = 0 ] || { echo "Bitte als root ausführen (sudo -i)"; exit 1; }
command -v systemctl >/dev/null || { echo "systemd fehlt – dieses Skript ist für einen normalen Server (Ubuntu/Debian)"; exit 1; }

# --- Einstellungen ---------------------------------------------------------------
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
put() {
  local k="$1" v="$2"
  if grep -qE "^$k=" "$ENV_FILE"; then
    local tmp; tmp=$(mktemp)
    grep -vE "^$k=" "$ENV_FILE" > "$tmp"
    cat "$tmp" > "$ENV_FILE"
    rm -f "$tmp"
  fi
  printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
}
ask() {
  # Wert aus Umgebung > vorhandener Datei > Eingabe
  local k="$1" text="$2" v="${!1:-}"
  [ -z "$v" ] && v=$(get "$k")
  if [ -z "$v" ]; then
    read -r -p "$text: " v < /dev/tty
  fi
  [ -n "$v" ] || { echo "$k fehlt"; exit 1; }
  put "$k" "$v"
}
random() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

ask GH_TOKEN "GitHub-Token (github_pat_…)"
ask APP_PASSWORD "Passwort für die App"
ask CF_TUNNEL_TOKEN "Cloudflare-Tunnel-Token für comfy.comfyusel.uk (eyJ…)"
[ -n "$(get POD_SECRET)" ] || put POD_SECRET "$(random)"
[ -n "$(get SESSION_SECRET)" ] || put SESSION_SECRET "$(random)"
[ -n "$(get DISCORD_WEBHOOK_URL)" ] || [ -z "${DISCORD_WEBHOOK_URL:-}" ] || put DISCORD_WEBHOOK_URL "$DISCORD_WEBHOOK_URL"
put SERVER_MODE 1
put DATA_DIR "$BASE/data"
put OUTPUT_DIR "$BASE/output"
put PORT 3000
put HOSTNAME 127.0.0.1
put NODE_ENV production
GH_TOKEN=$(get GH_TOKEN)
mkdir -p "$BASE/data" "$BASE/output"

# --- Pakete --------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
need=()
command -v curl >/dev/null || need+=(curl ca-certificates)
command -v xz >/dev/null || need+=(xz-utils)
if [ ${#need[@]} -gt 0 ]; then apt-get update -qq && apt-get install -y -qq "${need[@]}" >/dev/null; fi

node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0; }
if ! command -v node >/dev/null || [ "$(node_major)" -lt 22 ]; then
  log "Installiere Node.js 22 …"
  ARCH=$(uname -m); case "$ARCH" in x86_64) NARCH=x64 ;; aarch64) NARCH=arm64 ;; *) NARCH=$ARCH ;; esac
  NODE_VER=$(curl -fsSL "${CURL_NET[@]}" https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep -oE "node-v22\.[0-9]+\.[0-9]+-linux-${NARCH}\.tar\.xz" | head -1)
  curl -fsSL "${CURL_NET[@]}" "https://nodejs.org/dist/latest-v22.x/${NODE_VER}" | tar -xJ -C /usr/local --strip-components=1
fi
log "Node $(node -v)"

if ! command -v cloudflared >/dev/null; then
  log "Installiere cloudflared …"
  ARCH=$(uname -m); case "$ARCH" in x86_64) CARCH=amd64 ;; aarch64) CARCH=arm64 ;; *) CARCH=$ARCH ;; esac
  curl -fsSL "${CURL_NET[@]}" -o /usr/local/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CARCH}"
  chmod +x /usr/local/bin/cloudflared
fi

# --- Neueste App-Version --------------------------------------------------------
log "Lade App-Release von ${GH_REPO} …"
TMP=$(mktemp -d)
api="https://api.github.com/repos/${GH_REPO}/releases/tags/latest"
asset_url=$(curl -fsSL "${CURL_NET[@]}" -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" "$api" |
  grep -oE '"url": *"https://api.github.com/repos/[^"]+/releases/assets/[0-9]+"' | head -1 | sed -E 's/.*"(https[^"]+)"/\1/' || true)
if [ -n "$asset_url" ] && curl -fsSL "${CURL_NET[@]}" -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/octet-stream" -o "$TMP/app.tar.gz" "$asset_url"; then
  mkdir -p "$TMP/app"
  tar -xzf "$TMP/app.tar.gz" -C "$TMP/app"
  if [ -d "$APP_DIR" ]; then
    mv "$APP_DIR" "${APP_DIR}.old.$$"
  fi
  mv "$TMP/app" "$APP_DIR"
  [ -d "${APP_DIR}.old.$$" ] && rm -rf "${APP_DIR:?}.old.$$"
  log "App aktualisiert."
elif [ -f "$APP_DIR/server.js" ]; then
  log "WARNUNG: Release nicht erreichbar (GH_TOKEN?) – nutze vorhandene Version."
else
  log "FEHLER: Release nicht erreichbar und keine App vorhanden (GH_TOKEN prüfen)."
  exit 1
fi
rm -rf "${TMP:?}"

# --- systemd-Dienste -------------------------------------------------------------
NODE_BIN=$(command -v node)
CF_BIN=$(command -v cloudflared)
cat > /etc/systemd/system/pod-frontend.service <<EOF
[Unit]
Description=Pod-Frontend (App für ComfyUI)
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN $APP_DIR/server.js
Restart=always
RestartSec=3
# Platz lassen für die Discord-Bots
MemoryMax=1500M

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/pod-frontend-tunnel.service <<EOF
[Unit]
Description=Cloudflare Tunnel für comfy.comfyusel.uk
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=$ENV_FILE
ExecStart=$CF_BIN tunnel --no-autoupdate run --token \${CF_TUNNEL_TOKEN}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pod-frontend pod-frontend-tunnel >/dev/null 2>&1
systemctl restart pod-frontend pod-frontend-tunnel

for _ in $(seq 1 30); do curl -fs -o /dev/null http://127.0.0.1:3000/api/health && break; sleep 1; done
if curl -fs -o /dev/null http://127.0.0.1:3000/api/health; then log "App läuft."; else log "WARNUNG: App antwortet nicht – journalctl -u pod-frontend -n 50"; fi
systemctl is-active --quiet pod-frontend-tunnel && log "Tunnel läuft." || log "WARNUNG: Tunnel läuft nicht – journalctl -u pod-frontend-tunnel -n 50"

POD_SECRET=$(get POD_SECRET)
cat <<EOF

==================================================================
 Fertig. Die App läuft unter https://comfy.comfyusel.uk

 Im Vast-Pod-Template jetzt eintragen:
   VPS_URL     = https://comfy.comfyusel.uk
   POD_SECRET  = $POD_SECRET
 und CF_TUNNEL_TOKEN dort ENTFERNEN (der Tunnel läuft jetzt hier).

 Update später:   bash $0
 Logs:            journalctl -u pod-frontend -f
                  journalctl -u pod-frontend-tunnel -f
 Daten:           $BASE  (Galerie: $BASE/output)
==================================================================
EOF
