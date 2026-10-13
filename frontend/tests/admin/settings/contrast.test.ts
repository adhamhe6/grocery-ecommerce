import { describe, expect, it } from "vitest";
import { contrastRatio, parseHex, relativeLuminance, whiteTextContrast } from "@/components/admin/settings/contrast";

describe("WCAG contrast", () => {
  it("black on white is the maximum, 21:1, and identical colours are 1:1", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5); // order doesn't matter
  });
  it("matches published reference values", () => {
    expect(contrastRatio("#767676", "#FFFFFF")!).toBeCloseTo(4.54, 2); // the darkest grey that passes AA on white
    expect(contrastRatio("#777777", "#FFFFFF")!).toBeCloseTo(4.48, 2); // one step lighter fails
    expect(contrastRatio("#FF0000", "#FFFFFF")!).toBeCloseTo(4.0, 1);
    expect(relativeLuminance("#808080")!).toBeCloseTo(0.2159, 3);
  });
  it("is case-insensitive and rejects anything that isn't #RRGGBB", () => {
    expect(contrastRatio("#1f3d2b", "#FFFFFF")).toBe(contrastRatio("#1F3D2B", "#ffffff"));
    for (const bad of ["red", "#FFF", "#12345", "1F3D2B", "#GGGGGG", ""]) {
      expect(parseHex(bad)).toBeNull();
      expect(contrastRatio(bad, "#FFFFFF")).toBeNull();
    }
  });
});

describe("whiteTextContrast", () => {
  it("passes AA exactly at the threshold and fails just below", () => {
    expect(whiteTextContrast("#767676")).toMatchObject({ passesAA: true, display: "4.54" });
    expect(whiteTextContrast("#777777")).toMatchObject({ passesAA: false, display: "4.47" });
  });
  it("never rounds a near-miss up into a pass", () => {
    const r = whiteTextContrast("#777777")!;
    expect(r.ratio).toBeLessThan(4.5);
    expect(Number(r.display)).toBeLessThanOrEqual(r.ratio);
  });
  it("the shipped brand colours pass, and pale colours don't", () => {
    expect(whiteTextContrast("#1F3D2B")!.passesAA).toBe(true);
    expect(whiteTextContrast("#B8532F")!.passesAA).toBe(true);
    expect(whiteTextContrast("#E3A72F")!.passesAA).toBe(false);
    expect(whiteTextContrast("#FFFFFF")!.display).toBe("1.00");
  });
  it("is null for an unfinished colour", () => {
    expect(whiteTextContrast("#1F3D")).toBeNull();
  });
});
