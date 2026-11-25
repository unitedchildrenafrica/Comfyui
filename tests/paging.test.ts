import { describe, expect, it } from "vitest";
import { pageNumbers } from "@/lib/paging";

describe("pageNumbers", () => {
  it("wenige Seiten: alle", () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it("viele Seiten: Anfang, Umgebung, Ende", () => {
    expect(pageNumbers(1, 12)).toEqual([1, 2, "…", 12]);
    expect(pageNumbers(6, 12)).toEqual([1, "…", 5, 6, 7, "…", 12]);
    expect(pageNumbers(12, 12)).toEqual([1, "…", 11, 12]);
    expect(pageNumbers(3, 12)).toEqual([1, 2, 3, 4, "…", 12]);
  });
});
