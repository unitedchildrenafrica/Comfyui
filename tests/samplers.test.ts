import { describe, expect, it } from "vitest";
import { samplerLabel, samplerOptions } from "@/lib/samplers";

describe("sampler labels", () => {
  it("names samplers like TensorHub", () => {
    expect(samplerLabel("euler")).toBe("Euler");
    expect(samplerLabel("euler_ancestral")).toBe("Euler a (euler_ancestral)");
    expect(samplerLabel("dpmpp_2m")).toBe("DPM++ 2M (dpmpp_2m)");
    expect(samplerLabel("dpmpp_2m_sde_gpu")).toBe("DPM++ 2M SDE GPU (dpmpp_2m_sde_gpu)");
    expect(samplerLabel("dpmpp_2s_ancestral")).toBe("DPM++ 2S a (dpmpp_2s_ancestral)");
    expect(samplerLabel("euler_cfg_pp")).toBe("Euler CFG++ (euler_cfg_pp)");
    expect(samplerLabel("uni_pc")).toBe("UniPC (uni_pc)");
    expect(samplerLabel("something_new")).toBe("something new (something_new)");
  });
  it("keeps the ComfyUI value", () => {
    expect(samplerOptions(["euler_ancestral"])).toEqual([{ value: "euler_ancestral", label: "Euler a (euler_ancestral)" }]);
  });
});
