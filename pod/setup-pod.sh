#!/usr/bin/env bash
# Einmal pro neuem Pod ausführen (oder als On-Start-Skript im Pod-Template):
#   1. startet das Pod-Frontend + Cloudflare Tunnel (pod/start-frontend.sh) im Hintergrund
#   2. lädt alle Checkpoints, Anima-Modelle und LoRAs, die fehlen
#
# Idempotent: Vorhandene Dateien werden übersprungen, halbe Downloads fortgesetzt.
#
# Env (im Pod-Template setzen):
#   CIVITAI_TOKEN   Pflicht – Civitai-API-Token für die Downloads
#   GH_TOKEN        Pflicht – Read-only-Token für das private Repo
#   APP_PASSWORD    Pflicht – Login der App (siehe start-frontend.sh)
#   CF_TUNNEL_TOKEN, DISCORD_WEBHOOK_URL … wie in start-frontend.sh
#   COMFY_DIR       optional, Standard /workspace/ComfyUI
#   CIVITAI_BASE    optional, Standard https://civitai.red/api/download/models
#   SKIP_FRONTEND=1 nur Modelle laden
set -uo pipefail

GH_REPO="${GH_REPO:-unitedchildrenafrica/Comfyui}"
COMFY_DIR="${COMFY_DIR:-/workspace/ComfyUI}"
M="$COMFY_DIR/models"
CV="${CIVITAI_BASE:-https://civitai.red/api/download/models}"
T="${CIVITAI_TOKEN:-}"
LOG_DIR="${LOG_DIR:-/workspace/logs}"
mkdir -p "$LOG_DIR"

log() { echo "[setup-pod] $(date '+%H:%M:%S') $*"; }

if [ -z "$T" ]; then
  log "FEHLER: CIVITAI_TOKEN ist nicht gesetzt."
  exit 1
fi

# --- 1. Frontend + Tunnel im Hintergrund starten -----------------------------------
if [ "${SKIP_FRONTEND:-0}" != 1 ]; then
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  START="$HERE/start-frontend.sh"
  if [ ! -f "$START" ]; then
    START=/workspace/start-frontend.sh
    curl -fsSL -H "Authorization: Bearer ${GH_TOKEN:-}" -H "Accept: application/vnd.github.raw" \
      "https://api.github.com/repos/${GH_REPO}/contents/pod/start-frontend.sh" -o "$START" ||
      log "WARNUNG: start-frontend.sh konnte nicht geladen werden (GH_TOKEN?)"
  fi
  if [ -f "$START" ]; then
    log "Starte Frontend im Hintergrund (Log: $LOG_DIR/start-frontend.log) …"
    nohup bash "$START" > "$LOG_DIR/start-frontend.log" 2>&1 &
  fi
fi

# --- 2. Downloads -------------------------------------------------------------------
if ! command -v aria2c >/dev/null; then
  log "Installiere aria2 …"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq aria2 >/dev/null
fi

FAILED=()

# get <ordner> <dateiname> <modelId?fileId=…> [aria2|curl]
get() {
  local dir="$M/$1" name="$2" url="$CV/$3&token=$T" tool="${4:-aria2}"
  local dest="$dir/$name"
  mkdir -p "$dir"
  if [ -s "$dest" ] && [ ! -e "$dest.aria2" ]; then
    log "✓ $1/$name ist schon da"
    return 0
  fi
  log "↓ $1/$name"
  local ok=0
  if [ "$tool" = aria2 ]; then
    aria2c -x16 -s16 -c --console-log-level=warn --summary-interval=0 --download-result=hide \
      -d "$dir" -o "$name" "$url" && ok=1
  else
    curl -fL --retry 3 -sS -C - -o "$dest.part" "$url" && mv "$dest.part" "$dest" && ok=1
  fi
  # Fehlerseiten (z. B. ungültiger Token) sind winzig – nicht als Modell behalten
  if [ "$ok" = 1 ] && [ "$(stat -c %s "$dest" 2>/dev/null || echo 0)" -lt 1000000 ]; then
    log "✗ $name ist verdächtig klein – gelöscht"
    rm -f "$dest"
    ok=0
  fi
  [ "$ok" = 1 ] || FAILED+=("$1/$name")
}

# Checkpoints
get checkpoints wai_illustrious_v10.safetensors "1367422?fileId=1270636"
get checkpoints wai_illustrious_v17.safetensors "2883731?fileId=2763986"
get checkpoints ponyDiffusionV6XL.safetensors   "290640?fileId=228616"
get checkpoints nova3DCGXL_ilV90.safetensors    "2744564?fileId=2630962" curl
get checkpoints aniversePonyXL_v40.safetensors  "982480?fileId=888605" curl

# Anima
get diffusion_models anima-base-v1.0.safetensors "2945208?fileId=2824391"
get text_encoders    qwen_3_06b_base.safetensors "2945208?fileId=2824387"
get vae              qwen_image_vae.safetensors  "2110009?fileId=2004692"

# LoRAs
get loras incase_style.safetensors      "436219?fileId=356767" curl
get loras expressiveH.safetensors       "382152?fileId=306661" curl
get loras gothic_neon.safetensors       "398847?fileId=321669" curl
get loras disney_princesses.safetensors "244808?fileId=189513" curl

echo
ls -lh "$M"/checkpoints/*.safetensors "$M"/diffusion_models/anima* "$M"/text_encoders/qwen_3* "$M"/vae/qwen_image* \
  "$M"/loras/{incase_style,expressiveH,gothic_neon,disney_princesses}.safetensors 2>/dev/null
echo

if [ ${#FAILED[@]} -gt 0 ]; then
  log "FEHLGESCHLAGEN: ${FAILED[*]} – Skript einfach nochmal starten (setzt fort)."
  MSG="Modell-Download unvollständig: ${FAILED[*]}"
else
  log "Alle Modelle da."
  MSG="Alle Modelle geladen ✓"
fi
if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
  curl -fsS -H "Content-Type: application/json" -d "{\"content\": \"${MSG//\"/\\\"}\"}" "$DISCORD_WEBHOOK_URL" >/dev/null || true
fi
[ ${#FAILED[@]} -eq 0 ]
