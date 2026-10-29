#!/usr/bin/env bash
# Komplett-Setup für einen neuen Vast.ai-Pod (ComfyUI-Template).
#
#   bash setup.sh bilder   WAI/Pony/Anima: Checkpoints, Anima, LoRAs, Remacri, Inspire Pack
#   bash setup.sh video    MiniMax H3 Singularity: Custom Nodes, Modelle, LoRAs
#   bash setup.sh alles    beides
#
# Dazu jedes Mal: Pod-Frontend + Cloudflare Tunnel (pod/start-frontend.sh) und
# ComfyUI-Start auf Port 18188 (/workspace/start_comfy.sh).
# Idempotent: vorhandene Dateien werden übersprungen, halbe Downloads fortgesetzt.
#
# Env (im Pod-Template):
#   CIVITAI_TOKEN   Pflicht (bilder + video)
#   HF_TOKEN        Pflicht für video
#   GH_TOKEN, APP_PASSWORD, CF_TUNNEL_TOKEN   fürs Frontend (siehe start-frontend.sh)
#   DISCORD_WEBHOOK_URL   optional
#   WITH_QWEN=1     optional (video): llama-cpp-python für den Qwen-Prompt-Schreiber bauen
#   SKIP_FRONTEND=1 optional: kein Frontend/Tunnel starten

MODE="${1:-alles}"
case "$MODE" in bilder|video|alles) ;; *) echo "Aufruf: bash setup.sh bilder|video|alles"; exit 1 ;; esac
want() { [ "$MODE" = alles ] || [ "$MODE" = "$1" ]; }

C="${COMFY_DIR:-/workspace/ComfyUI}"
P=/venv/main/bin/python; [ -x "$P" ] || P=$(command -v python3)
PORT="${COMFY_PORT:-18188}"
M=$C/models
GH_REPO="${GH_REPO:-unitedchildrenafrica/Comfyui}"
GH_REF="${GH_REF:-main}"
LOG_DIR=/workspace/logs
FRONTEND_VERSION="1.53.6"   # neuere Frontends (1.55.x) lassen die DaSiWa-Buttons abstürzen
FAIL=()
mkdir -p "$LOG_DIR" "$M/.done"
step() { echo; echo "===== $*"; }

# --- Pflicht-Variablen prüfen ---------------------------------------------------------
MISSING=()
[ -n "${CIVITAI_TOKEN:-}" ] || MISSING+=(CIVITAI_TOKEN)
if want video && [ -z "${HF_TOKEN:-}" ]; then MISSING+=(HF_TOKEN); fi
if [ "${SKIP_FRONTEND:-0}" != 1 ]; then
  for v in GH_TOKEN APP_PASSWORD; do [ -n "${!v:-}" ] || MISSING+=("$v"); done
fi
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "!! Fehlende Umgebungsvariablen: ${MISSING[*]} – im Pod-Template eintragen."
  exit 1
fi

# --- 0. Frontend + Tunnel sofort starten (App nach ~1 Min erreichbar) ----------------
if [ "${SKIP_FRONTEND:-0}" != 1 ]; then
  step "0. Pod-Frontend + Tunnel (im Hintergrund, Log: $LOG_DIR/start-frontend.log)"
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  START="$HERE/start-frontend.sh"
  if [ ! -f "$START" ]; then
    START=/workspace/start-frontend.sh
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github.raw" \
      "https://api.github.com/repos/$GH_REPO/contents/pod/start-frontend.sh?ref=$GH_REF" -o "$START" ||
      FAIL+=("start-frontend.sh laden")
  fi
  # Tunnel nicht erst nach ComfyUI starten – ComfyUI kommt hier erst ganz am Ende hoch
  if [ -f "$START" ]; then
    COMFY_URL="http://127.0.0.1:$PORT" WAIT_FOR_COMFY=0 nohup bash "$START" > "$LOG_DIR/start-frontend.log" 2>&1 &
  fi
fi

step "1. Umgebung"
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
Q=$(awk '{print $1" "$2}' /sys/fs/cgroup/cpu.max 2>/dev/null)
if [ -n "$Q" ] && [ "${Q%% *}" != "max" ]; then VCPU=$(( ${Q%% *} / ${Q##* } )); else VCPU=$(nproc); fi
THREADS=$(( VCPU > 2 ? VCPU - 1 : 1 ))
echo ">> Modus $MODE | vCPUs $VCPU → Threads $THREADS"

NEED=55; want video && NEED=90; [ "$MODE" = alles ] && NEED=140
FREE=$(df -BG --output=avail /workspace | tail -1 | tr -dc 0-9)
if [ "${FREE:-0}" -lt "$NEED" ]; then
  echo "!! Nur ${FREE} GB frei auf /workspace – für '$MODE' ca. $NEED GB nötig (bei schon geladenen Modellen harmlos)"
  sleep 5
fi

step "2. Vast-ComfyUI stoppen"
supervisorctl stop comfyui >/dev/null 2>&1
pkill -f unbuffer 2>/dev/null; pkill -f main.py 2>/dev/null; sleep 3

step "3. System + ComfyUI"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq aria2 ffmpeg git zip >/dev/null
if [ ! -f "$C/main.py" ]; then
  git clone -q https://github.com/comfyanonymous/ComfyUI.git "$C" || { echo "!! ComfyUI-Klon fehlgeschlagen"; exit 1; }
elif want video; then
  # H3 braucht das aktuelle ComfyUI
  git -C "$C" fetch origin -q && git -C "$C" reset --hard origin/master -q &&
    git -C "$C" branch --set-upstream-to=origin/master master >/dev/null 2>&1
fi
echo ">> ComfyUI: $(git -C "$C" log -1 --format='%h %cd')"
cd "$C" && $P -m pip install -q -r requirements.txt

# PyTorch muss zu CUDA 13 passen, manche Vast-Images bringen noch cu128 mit
DRV=$(sed -n 's/.*Kernel Module.*  \([0-9]*\)\..*/\1/p' /proc/driver/nvidia/version 2>/dev/null | head -1)
TCU=$($P -c "import torch;print(torch.version.cuda or '')" 2>/dev/null)
if [ "${DRV:-0}" -ge 580 ] && [[ "$TCU" != 13* ]]; then
  echo "-- PyTorch ist für CUDA $TCU, Treiber $DRV kann 13 → installiere cu130"
  $P -m pip install -q --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
elif [ "${DRV:-0}" -lt 580 ]; then
  echo "!! Treiber $DRV < 580 (kein CUDA 13) → 'comfy kitchen attention' im H3-Workflow geht evtl. nicht"
fi
$P -c "import torch; print('>> torch', torch.__version__, torch.cuda.is_available()); torch.zeros(1).cuda()" || FAIL+=("torch")
$P -m pip install -q "comfyui-frontend-package==$FRONTEND_VERSION"

step "4. Custom Nodes"
mkdir -p "$C/custom_nodes"; cd "$C/custom_nodes" || exit 1
REPOS=()
want bilder && REPOS+=(ltdrdata/ComfyUI-Inspire-Pack)
want video && REPOS+=(rgthree/rgthree-comfy kijai/ComfyUI-KJNodes city96/ComfyUI-GGUF
  darksidewalker/ComfyUI-DaSiWa-Nodes Kosinkadink/ComfyUI-VideoHelperSuite
  pixaroma/ComfyUI-Pixaroma huchukato/ComfyUI-PerfectVideoResolution huchukato/ComfyUI-QwenVL-Mod)
for repo in "${REPOS[@]}"; do
  d="${repo#*/}"
  if [ -d "$d" ]; then
    git -C "$d" fetch -q origin
    R=$(git -C "$d" remote show origin | sed -n 's/.*HEAD branch: //p')
    git -C "$d" reset --hard "origin/${R:-main}" -q 2>/dev/null || echo "-- $d Update übersprungen"
  else
    git clone -q --depth 1 "https://github.com/$repo" "$d" || FAIL+=("$d")
  fi
  [ -f "$d/requirements.txt" ] && $P -m pip install -q -r "$d/requirements.txt"
done
want bilder && mkdir -p ComfyUI-Inspire-Pack/prompts && touch ComfyUI-Inspire-Pack/prompts/prompts.txt
# Frontend nochmal festhalten, falls ein Node-Paket es hochgezogen hat
$P -m pip install -q "comfyui-frontend-package==$FRONTEND_VERSION"

H=$C/custom_nodes/ComfyUI-DaSiWa-Nodes/nodes/helper_pyav_video.py
if want video; then
  step "5. x264-Patch (schnelleres Encoding)"
  sed -i "s/{\"crf\": q, \"preset\": \"medium\"}/{\"crf\": q, \"preset\": \"veryfast\", \"threads\": \"$THREADS\"}/" "$H" 2>/dev/null
  grep -q '"preset": "veryfast"' "$H" 2>/dev/null && echo ">> aktiv" || echo "-- nicht gesetzt"
fi

# --- Download-Helfer -----------------------------------------------------------------
CV="https://civitai.red/api/download/models"
HFH=(--header="Authorization: Bearer ${HF_TOKEN:-}")

small() { [ "$(stat -c %s "$1" 2>/dev/null || echo 0)" -lt 1000000 ]; }

# dl <url> <ordner> <datei> [aria2-optionen…] – aria2, bei Ablehnung curl
dl() {
  local url="$1" dir="$2" name="$3"; shift 3
  local dest="${dir:?}/${name:?}"
  mkdir -p "$dir"
  if [ -s "$dest" ] && [ ! -f "$dest.aria2" ]; then echo ">> skip $name"; return; fi
  if ! aria2c -x16 -s16 -k1M -c --auto-file-renaming=false --console-log-level=warn --summary-interval=60 \
      --download-result=hide "$@" -d "$dir" -o "$name" "$url"; then
    echo "-- aria2 abgelehnt, versuche curl: $name"
    rm -f "${dir:?}/${name:?}" "${dir:?}/${name:?}.aria2"
    local hdr=(); [ $# -gt 0 ] && hdr=(-H "${1#--header=}")
    curl -sSL --fail --retry 3 "${hdr[@]}" -o "$dest" "$url" || rm -f "${dir:?}/${name:?}"
  fi
  # Fehlerseiten (z. B. falscher Token) sind winzig – nicht als Modell behalten
  if [ ! -s "$dest" ] || small "$dest"; then
    rm -f "${dir:?}/${name:?}"
    echo "!! FEHLER $name"; FAIL+=("$name")
  fi
}
# Civitai: Token in der URL (Header scheitert am R2-Redirect)
civ() { dl "$CV/$1&token=$CIVITAI_TOKEN" "$2" "$3"; }

# civj <id?fileId> <ordner> <anzeige> – Originaldateinamen von Civitai übernehmen
civj() {
  local key; key=$(echo "$1" | tr -c 'a-zA-Z0-9' '_')
  if [ -f "$M/.done/$key" ] && [ -f "$(cat "$M/.done/$key")" ]; then echo ">> skip $3"; return; fi
  mkdir -p "$2"
  local f; f=$(cd "$2" && curl -sL --fail -J -O -w "%{filename_effective}" "$CV/$1&token=$CIVITAI_TOKEN")
  if [ -n "$f" ] && [ -s "$2/$f" ] && ! small "$2/$f"; then
    echo ">> $3 → $f"; echo "$2/$f" > "$M/.done/$key"
  else
    echo "!! $3 nicht geladen"; FAIL+=("$3")
  fi
}

if want bilder; then
  step "6a. Bilder: SDXL-Checkpoints"
  civ "1367422?fileId=1270636" "$M/checkpoints" wai_illustrious_v10.safetensors
  civ "2883731?fileId=2763986" "$M/checkpoints" wai_illustrious_v17.safetensors
  civ "982480?fileId=888605"   "$M/checkpoints" aniversePonyXL_v40.safetensors
  civ "290640?fileId=228616"   "$M/checkpoints" ponyDiffusionV6XL.safetensors
  civ "2744564?fileId=2630962" "$M/checkpoints" nova3DCGXL_ilV90.safetensors
  civj "1023901?fileId=929617" "$M/checkpoints" "Illu-Merge"

  step "6b. Bilder: Anima"
  civ "2945208?fileId=2824391" "$M/diffusion_models" anima-base-v1.0.safetensors
  civ "2945208?fileId=2824387" "$M/text_encoders"    qwen_3_06b_base.safetensors
  civ "2110009?fileId=2004692" "$M/vae"              qwen_image_vae.safetensors
  civj "3108589?fileId=2988553" "$M/diffusion_models" "Anima Turbo"

  step "6c. Bilder: Remacri-Upscaler + LoRAs"
  dl "https://huggingface.co/FacehugmanIII/4x_foolhardy_Remacri/resolve/main/4x_foolhardy_Remacri.pth" \
     "$M/upscale_models" 4x_foolhardy_Remacri.pth
  civ "436219?fileId=356767" "$M/loras" incase_style.safetensors
  civ "382152?fileId=306661" "$M/loras" expressiveH.safetensors
  civ "398847?fileId=321669" "$M/loras" gothic_neon.safetensors
  civ "244808?fileId=189513" "$M/loras" disney_princesses.safetensors
fi

if want video; then
  step "7a. Video: MiniMax H3 Singularity"
  HF=https://huggingface.co
  # SINGULARITY v1.3 (WarmBloodAban) – Ref-Fusion, kein Ref-LoRA nötig
  dl "$HF/WarmBloodAban/Minimax-h3_Singularity/resolve/main/Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors" \
     "$M/diffusion_models" Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors "${HFH[@]}"
  # Heretic Text-Encoder (unzensiert, NVFP4)
  dl "$HF/sakamakismile/Qwen3-VL-32B-Heretic-MiniMax-H3-NVFP4/resolve/main/qwen3vl_32b_heretic_minimax_h3_nvfp4.safetensors" \
     "$M/text_encoders" qwen3vl_32b_heretic_minimax_h3_nvfp4.safetensors "${HFH[@]}"
  # Offizielle REF2V-Turbo-LoRA (4-Step, Comfy-Org)
  dl "$HF/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors" \
     "$M/loras" minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors "${HFH[@]}"
  dl "$HF/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" \
     "$M/text_encoders" qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors "${HFH[@]}"
  dl "$HF/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors" \
     "$M/vae/MiniMaxH3" minimax_h3_video_vae_fp16.safetensors "${HFH[@]}"
  dl "$HF/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors" \
     "$M/vae/MiniMaxH3" minimax_h3_audio_vae_fp32.safetensors "${HFH[@]}"
  dl "$HF/Kijai/MiniMax-H3-TAE/resolve/main/vae_approx/taeh3.safetensors" \
     "$M/vae_approx" taeh3.safetensors "${HFH[@]}"
  dl "$HF/Comfy-Org/frame_interpolation/resolve/main/frame_interpolation/rife_v4.26.safetensors" \
     "$M/frame_interpolation" rife_v4.26.safetensors "${HFH[@]}"
  dl "$HF/Kim2091/2x-AnimeSharpV4/resolve/main/2x-AnimeSharpV4_RCAN.safetensors" \
     "$M/upscale_models" 2x-AnimeSharpV4_RCAN.safetensors "${HFH[@]}"
  # Manche Workflows suchen die VAEs im vae-Hauptordner
  ln -sf "$M/vae/MiniMaxH3/minimax_h3_video_vae_fp16.safetensors" "$M/vae/minimax_h3_video_vae_fp16.safetensors"
  ln -sf "$M/vae/MiniMaxH3/minimax_h3_audio_vae_fp32.safetensors" "$M/vae/minimax_h3_audio_vae_fp32.safetensors"

  step "7b. Video: LoRAs"
  while read -r name id fid; do
    [ -z "$name" ] && continue
    civ "$id?fileId=$fid" "$M/loras" "$name"
  done <<'LORAS'
MysticXXXV4.safetensors 3266628 3150341
VideoReasoning.safetensors 3220766 3102749
DoggyStyleLegUp.safetensors 3303351 3190549
CowGirlBehind.safetensors 3311202 3196509
AIOSEXLora.safetensors 3268303 3152083
POVDoggyStyle.safetensors 3300169 3185098
MalePenis.safetensors 3247473 3130327
MaleAnatomy.safetensors 3250559 3133640
CumOnFace.safetensors 3202064 3083352
DildoMasturbation.safetensors 3285564 3169836
FingeringSelf.safetensors 3342542 3229287
LORAS
fi

step "8. ComfyUI starten (Port $PORT)"
cat > /workspace/start_comfy.sh << EOF
#!/usr/bin/env bash
supervisorctl stop comfyui >/dev/null 2>&1
pkill -f unbuffer 2>/dev/null; pkill -f main.py 2>/dev/null; sleep 4
sed -i 's/{"crf": q, "preset": "medium"}/{"crf": q, "preset": "veryfast", "threads": "$THREADS"}/' "$H" 2>/dev/null
cd $C
OMP_NUM_THREADS=$THREADS MKL_NUM_THREADS=$THREADS PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \\
nohup $P main.py --listen 0.0.0.0 --port $PORT --enable-cors-header \\
  --disable-smart-memory --cache-none --reserve-vram 1.0 > /workspace/comfy.log 2>&1 &
echo "ComfyUI startet auf Port $PORT – Log: tail -f /workspace/comfy.log"
EOF
chmod +x /workspace/start_comfy.sh
bash /workspace/start_comfy.sh
UP=0
for _ in $(seq 1 100); do curl -fs "localhost:$PORT/system_stats" >/dev/null && UP=1 && break; sleep 3; done
[ "$UP" = 1 ] || FAIL+=("ComfyUI startet nicht (siehe /workspace/comfy.log)")

step "CHECKS"
has() { curl -s "localhost:$PORT/object_info/$1" | grep -q "\"$2\""; }
if want bilder; then
  has "LoadPromptsFromFile%20%2F%2FInspire" "LoadPromptsFromFile //Inspire" && echo "OK  Inspire-Nodes" || FAIL+=("Inspire-Nodes")
  if has ModelSamplingAuraFlow ModelSamplingAuraFlow; then echo "OK  ModelSamplingAuraFlow (Anima Shift)"
  else echo "--  ModelSamplingAuraFlow fehlt (App nutzt dann ModelSamplingSD3)"; fi
  echo "-- Checkpoints:"; ls -lh "$M"/checkpoints/*.safetensors 2>/dev/null | awk '{print "   "$5"\t"$9}'
fi
if want video; then
  ffmpeg -hide_banner -f lavfi -i testsrc=duration=1:size=1280x720:rate=24 -c:v h264_nvenc -f null - >/dev/null 2>&1 &&
    echo "NVENC: JA" || echo "NVENC: NEIN (libx264 auf CPU)"
  for n in MiniMaxH3SigmaShift MiniMaxH3Director MiniMaxH3DirectorGuide DaSiWa_EnhancedVideoCombine DaSiWa_LTX2LoraLoader \
           DaSiWa_SeedControl ModelPreviewOverrideKJ FrameInterpolationModelLoader VHS_VideoCombine; do
    has "$n" "$n" && echo "OK  $n" || FAIL+=("$n")
  done
fi
echo "-- Dateien:"
for d in checkpoints diffusion_models text_encoders vae vae_approx loras frame_interpolation upscale_models; do
  echo "   $d: $(find "$M/$d" \( -name '*.safetensors' -o -name '*.pth' \) 2>/dev/null | wc -l)"
done
ls "$M"/*/*.aria2 2>/dev/null && FAIL+=("unfertige Downloads")
grep -q "already in use" /workspace/comfy.log 2>/dev/null && FAIL+=("Port $PORT belegt")

if [ "${WITH_QWEN:-0}" = 1 ] && want video; then
  step "OPTIONAL: llama-cpp-python mit CUDA (10–20 Min)"
  if command -v nvcc >/dev/null 2>&1 || [ -x /usr/local/cuda/bin/nvcc ]; then
    export PATH=/usr/local/cuda/bin:$PATH
    apt-get install -y -qq cmake build-essential >/dev/null
    CMAKE_ARGS="-DGGML_CUDA=on" FORCE_CMAKE=1 $P -m pip install -q --no-cache-dir \
      "llama-cpp-python @ git+https://github.com/JamePeng/llama-cpp-python" &&
      echo "OK  llama-cpp-python – ComfyUI neu starten: bash /workspace/start_comfy.sh" ||
      echo "!! llama-cpp-Build fehlgeschlagen – Workflow mit passthrough=true nutzen"
  else
    echo "!! Kein nvcc auf diesem Pod – Qwen-Schreiber nicht möglich"
  fi
fi

echo
GPU=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
if [ ${#FAIL[@]} -gt 0 ]; then
  MSG="Setup '$MODE' fertig MIT PROBLEMEN: ${FAIL[*]} – Skript nochmal starten (setzt fort)"
else
  MSG="Setup '$MODE' fertig ✓ ($GPU) – https://comfy.comfyusel.uk"
fi
echo ">> $MSG"
[ "${SKIP_FRONTEND:-0}" != 1 ] && echo ">> Frontend-Logs: $LOG_DIR/start-frontend.log, $LOG_DIR/frontend.log, $LOG_DIR/tunnel.log"
if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
  curl -fsS -H "Content-Type: application/json" -d "{\"content\": \"${MSG//\"/\\\"}\"}" "$DISCORD_WEBHOOK_URL" >/dev/null || true
fi
[ ${#FAIL[@]} -eq 0 ]
