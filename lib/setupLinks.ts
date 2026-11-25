// LoRAs, die pod/setup.sh fest herunterlädt. Erscheinen mit Link in der LoRA-Liste („Modelle“),
// damit wirklich alle LoRA-Links an einer Stelle stehen. tests/setupLinks.test.ts prüft, dass
// diese Liste zu setup.sh passt.

const CV = "https://civitai.red/api/download/models";

/** [Dateiname, Pfad hinter /api/download/models/] */
const SETUP_LORAS: [string, string][] = [
  // Bilder
  ["incase_style.safetensors", "436219?fileId=356767"],
  ["expressiveH.safetensors", "382152?fileId=306661"],
  ["gothic_neon.safetensors", "398847?fileId=321669"],
  ["disney_princesses.safetensors", "244808?fileId=189513"],
  // Krea-2-LoRAs stehen schon in BUILTIN_MODEL_LINKS (lib/server/modelRegistry.ts)
  // Video (MiniMax H3)
  ["MysticXXXV4.safetensors", "3266628?fileId=3150341"],
  ["VideoReasoning.safetensors", "3220766?fileId=3102749"],
  ["DoggyStyleLegUp.safetensors", "3303351?fileId=3190549"],
  ["CowGirlBehind.safetensors", "3311202?fileId=3196509"],
  ["AIOSEXLora.safetensors", "3268303?fileId=3152083"],
  ["POVDoggyStyle.safetensors", "3300169?fileId=3185098"],
  ["MalePenis.safetensors", "3247473?fileId=3130327"],
  ["MaleAnatomy.safetensors", "3250559?fileId=3133640"],
  ["CumOnFace.safetensors", "3202064?fileId=3083352"],
  ["FingeringSelf.safetensors", "3342542?fileId=3229287"],
];

const HF = "https://huggingface.co";

export const SETUP_LORA_LINKS: { filename: string; url: string }[] = [
  ...SETUP_LORAS.map(([filename, p]) => ({ filename, url: `${CV}/${p}` })),
  { filename: "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors", url: `${HF}/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` },
];
