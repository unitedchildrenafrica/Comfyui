// Lesbare Sampler-Namen wie bei TensorHub/A1111 („Euler a“ statt „euler_ancestral“).
// Die Liste selbst kommt weiter live aus /object_info – hier wird nur beschriftet.

const WORDS: Record<string, string> = {
  euler: "Euler",
  ancestral: "a",
  dpmpp: "DPM++",
  dpm: "DPM",
  sde: "SDE",
  gpu: "GPU",
  cfg: "CFG",
  pp: "++",
  lms: "LMS",
  ddim: "DDIM",
  ddpm: "DDPM",
  lcm: "LCM",
  heun: "Heun",
  heunpp2: "Heun++ 2",
  deis: "DEIS",
  ipndm: "iPNDM",
  bh2: "BH2",
  res: "Res",
  multistep: "Multistep",
  fast: "Fast",
  adaptive: "Adaptive",
  er: "ER",
  seeds: "Seeds",
  sa: "SA",
  solver: "Solver",
  gradient: "Gradient",
  estimation: "Estimation",
};

export function samplerLabel(name: string): string {
  const pretty = name
    .replace(/^uni_pc/, "unipc")
    .split("_")
    .map((w) => (w === "unipc" ? "UniPC" : (WORDS[w] ?? (/^\d+[a-z]$/.test(w) ? w.toUpperCase() : w))))
    .join(" ")
    .replace(/ \+\+/g, "++");
  return pretty.toLowerCase() === name.toLowerCase() ? pretty : `${pretty} (${name})`;
}

export function samplerOptions(names: string[]) {
  return names.map((value) => ({ value, label: samplerLabel(value) }));
}
