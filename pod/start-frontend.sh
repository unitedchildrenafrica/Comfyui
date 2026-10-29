#!/usr/bin/env bash
# Startet das Pod-Frontend + Cloudflare Tunnel auf einem Vast.ai- oder RunPod-Pod.
# Idempotent: mehrfach ausführen ist ok (laufende Prozesse werden ersetzt, nicht verdoppelt).
#
# Env (im Pod-Template setzen):
#   APP_PASSWORD        Pflicht – Login-Passwort der App
#   GH_TOKEN            Read-only-Token für das private Repo (Release-Download)
#   CF_TUNNEL_TOKEN     Token des festen Cloudflare Tunnels (sonst Quick Tunnel)
#   SESSION_SECRET      optional – sonst wird einer erzeugt und in DATA_DIR gespeichert
#   DISCORD_WEBHOOK_URL optional – Nachricht, sobald der Pod bereit ist
#   GH_REPO             optional, Standard: unitedchildrenafrica/Comfyui
#   COMFY_URL           optional, Standard: http://127.0.0.1:18188 (Port aus setup.sh)
#   WAIT_FOR_COMFY      optional, Sekunden warten auf ComfyUI vor dem Tunnel-Start (Standard 600, 0 = sofort)
#   DATA_DIR            optional, Standard: /workspace/pod-frontend-data
#   PUBLIC_URL          optional, Standard: https://comfy.comfyusel.uk
#   MODELS_DIR          optional, Standard: /workspace/ComfyUI/models („Modelle laden“ in der App)
#   OUTPUT_DIR          optional, Standard: /workspace/ComfyUI/output (ZIP-Download in der Galerie)
#   CIVITAI_TOKEN, HF_TOKEN  optional – damit die App Modelle per Link laden kann
set -euo pipefail

GH_REPO="${GH_REPO:-unitedchildrenafrica/Comfyui}"
APP_DIR="${APP_DIR:-/opt/pod-frontend}"
LOG_DIR="${LOG_DIR:-/workspace/logs}"
DATA_DIR="${DATA_DIR:-/workspace/pod-frontend-data}"
COMFY_URL="${COMFY_URL:-http://127.0.0.1:18188}"
WAIT_FOR_COMFY="${WAIT_FOR_COMFY:-600}"
PUBLIC_URL="${PUBLIC_URL:-https://comfy.comfyusel.uk}"
PORT="${PORT:-3000}"
MODELS_DIR="${MODELS_DIR:-/workspace/ComfyUI/models}"
OUTPUT_DIR="${OUTPUT_DIR:-/workspace/ComfyUI/output}"
CIVITAI_TOKEN="${CIVITAI_TOKEN:-}"
HF_TOKEN="${HF_TOKEN:-}"
RUN_DIR="/tmp/pod-frontend"

mkdir -p "$LOG_DIR" "$DATA_DIR" "$RUN_DIR"
log() { echo "[pod-frontend] $(date '+%H:%M:%S') $*"; }
# Pod-Leitungen wackeln manchmal (Connection reset) → Netzwerk-Aufrufe automatisch wiederholen
CURL_NET=(--retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 20)

if [ -z "${APP_PASSWORD:-}" ]; then
  log "FEHLER: APP_PASSWORD ist nicht gesetzt – ohne Passwort startet die App nicht."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt_updated=0
apt_install() {
  if [ "$apt_updated" = 0 ]; then apt-get update -qq; apt_updated=1; fi
  apt-get install -y -qq "$@" >/dev/null
}
command -v curl >/dev/null || apt_install curl ca-certificates
command -v tar >/dev/null || apt_install tar

# --- 1. Node.js 22 ---------------------------------------------------------------
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0; }
if ! command -v node >/dev/null || [ "$(node_major)" -lt 22 ]; then
  log "Installiere Node.js 22 …"
  ARCH=$(uname -m); case "$ARCH" in x86_64) NARCH=x64 ;; aarch64) NARCH=arm64 ;; *) NARCH=$ARCH ;; esac
  NODE_VER=$(curl -fsSL "${CURL_NET[@]}" https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep -oE "node-v22\.[0-9]+\.[0-9]+-linux-${NARCH}\.tar\.xz" | head -1)
  command -v xz >/dev/null || apt_install xz-utils
  curl -fsSL "${CURL_NET[@]}" "https://nodejs.org/dist/latest-v22.x/${NODE_VER}" | tar -xJ -C /usr/local --strip-components=1
fi
log "Node $(node -v)"

# --- 2. cloudflared --------------------------------------------------------------
if ! command -v cloudflared >/dev/null; then
  log "Installiere cloudflared …"
  ARCH=$(uname -m); case "$ARCH" in x86_64) CARCH=amd64 ;; aarch64) CARCH=arm64 ;; *) CARCH=$ARCH ;; esac
  curl -fsSL "${CURL_NET[@]}" -o /usr/local/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CARCH}"
  chmod +x /usr/local/bin/cloudflared
fi

# --- 3. Neuestes Release herunterladen -------------------------------------------
download_release() {
  local ipflag="${1:-}"
  local auth=()
  [ -n "${GH_TOKEN:-}" ] && auth=(-H "Authorization: Bearer ${GH_TOKEN}")
  local api="https://api.github.com/repos/${GH_REPO}/releases/tags/latest"
  local asset_url
  asset_url=$(curl -fsSL $ipflag "${CURL_NET[@]}" "${auth[@]}" -H "Accept: application/vnd.github+json" "$api" |
    grep -oE '"url": *"https://api.github.com/repos/[^"]+/releases/assets/[0-9]+"' | head -1 | sed -E 's/.*"(https[^"]+)"/\1/')
  if [ -z "$asset_url" ]; then
    log "Release nicht erreichbar – Netzwerk zu GitHub gestört oder GH_TOKEN fehlt/ungültig"
    return 1
  fi
  curl -fsSL $ipflag "${CURL_NET[@]}" "${auth[@]}" -H "Accept: application/octet-stream" -o "$RUN_DIR/pod-frontend.tar.gz" "$asset_url" || return 1
  rm -rf "${APP_DIR}.new"
  mkdir -p "${APP_DIR}.new"
  tar -xzf "$RUN_DIR/pod-frontend.tar.gz" -C "${APP_DIR}.new"
  rm -rf "${APP_DIR}.old"
  [ -d "$APP_DIR" ] && mv "$APP_DIR" "${APP_DIR}.old"
  mv "${APP_DIR}.new" "$APP_DIR"
  rm -rf "${APP_DIR}.old"
}
log "Lade Release von ${GH_REPO} …"
# Zweiter Versuch nur über IPv4 – bei Vast hakt manchmal die IPv6-Route zu GitHub
if ! download_release && ! { log "Nochmal über IPv4 …"; download_release -4; }; then
  [ -f "$APP_DIR/server.js" ] && log "Nutze vorhandene Version in $APP_DIR" || exit 1
fi

# --- Session-Secret dauerhaft machen (Login überlebt Neustarts) -------------------
if [ -z "${SESSION_SECRET:-}" ]; then
  if [ ! -s "$DATA_DIR/.session_secret" ]; then
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$DATA_DIR/.session_secret"
    chmod 600 "$DATA_DIR/.session_secret"
  fi
  SESSION_SECRET=$(cat "$DATA_DIR/.session_secret")
fi

# Alten Prozess beenden (idempotent)
stop_pid() {
  local f="$RUN_DIR/$1.pid"
  if [ -f "$f" ]; then
    local pid kids; pid=$(cat "$f")
    # Erst die Neustart-Schleife beenden, dann ihre Kinder (sonst startet sie neu)
    kids=$(pgrep -P "$pid" 2>/dev/null || true)
    kill "$pid" 2>/dev/null || true
    [ -n "$kids" ] && kill $kids 2>/dev/null || true
    rm -f "$f"
  fi
}

# --- 4. App starten (Neustart-Schleife, kein systemd) -----------------------------
stop_pid frontend
pkill -f "node $APP_DIR/server.js" 2>/dev/null || true
log "Starte App auf 127.0.0.1:$PORT …"
(
  # Nur lokal lauschen – von außen ist die App ausschließlich über den Tunnel erreichbar
  export APP_PASSWORD SESSION_SECRET COMFY_URL DATA_DIR MODELS_DIR OUTPUT_DIR CIVITAI_TOKEN HF_TOKEN PORT HOSTNAME=127.0.0.1 NODE_ENV=production
  cd "$APP_DIR"
  while true; do
    echo "[$(date)] start" >> "$LOG_DIR/frontend.log"
    node "$APP_DIR/server.js" >> "$LOG_DIR/frontend.log" 2>&1 || true
    echo "[$(date)] beendet, Neustart in 3 s" >> "$LOG_DIR/frontend.log"
    sleep 3
  done
) </dev/null >/dev/null 2>&1 &
echo $! > "$RUN_DIR/frontend.pid"
disown || true

# --- 5. Auf ComfyUI warten --------------------------------------------------------
if [ "$WAIT_FOR_COMFY" -gt 0 ]; then
  log "Warte auf ComfyUI ($COMFY_URL) …"
  END=$(( $(date +%s) + WAIT_FOR_COMFY ))
  until curl -fs -o /dev/null "$COMFY_URL/system_stats"; do
    if [ "$(date +%s)" -ge "$END" ]; then
      log "ComfyUI antwortet noch nicht – Tunnel startet trotzdem (App zeigt 'ComfyUI antwortet nicht')."
      break
    fi
    sleep 2
  done
fi

# --- 6. Cloudflare Tunnel --------------------------------------------------------
stop_pid tunnel
pkill -f "cloudflared tunnel" 2>/dev/null || true
: > "$LOG_DIR/tunnel.log"
if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
  log "Starte festen Tunnel → $PUBLIC_URL"
  nohup cloudflared tunnel --no-autoupdate run --token "$CF_TUNNEL_TOKEN" >> "$LOG_DIR/tunnel.log" 2>&1 &
  echo $! > "$RUN_DIR/tunnel.pid"
  URL="$PUBLIC_URL"
else
  log "Kein CF_TUNNEL_TOKEN – starte Quick Tunnel …"
  nohup cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" >> "$LOG_DIR/tunnel.log" 2>&1 &
  echo $! > "$RUN_DIR/tunnel.pid"
  URL=""
  for i in $(seq 1 60); do
    URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | head -1 || true)
    [ -n "$URL" ] && break
    sleep 1
  done
  log "Quick-Tunnel-Adresse: ${URL:-(nicht gefunden, siehe $LOG_DIR/tunnel.log)}"
fi

# --- 7. Discord ------------------------------------------------------------------
if [ -n "${DISCORD_WEBHOOK_URL:-}" ] && [ -n "$URL" ]; then
  GPU=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || echo "GPU unbekannt")
  MSG="Pod bereit: ${URL} (${GPU})"
  curl -fsS -H "Content-Type: application/json" -d "{\"content\": \"${MSG//\"/\\\"}\"}" "$DISCORD_WEBHOOK_URL" >/dev/null || log "Discord-Nachricht fehlgeschlagen"
fi

log "Fertig. Logs: $LOG_DIR/frontend.log, $LOG_DIR/tunnel.log"
