import { describe, expect, it } from "vitest";
import {
  checkPick, decimalInput, compareDecimal, divRound, fmtMoney, fmtQty, formatScaled, lineTotal, normaliseQty, parseMoney, parseQty, parseScaled, priceImpact, stepFor, stepQty, subMoney, subQty, sumMoney, toleranceWindow,
} from "@/components/admin/orders/decimal";

describe("parseScaled / formatScaled", () => {
  it("parses plain decimals into scaled integers", () => {
    expect(parseScaled("12.5", 2)).toBe(1250n);
    expect(parseScaled("0.001", 3)).toBe(1n);
    expect(parseScaled(".5", 3)).toBe(500n);
    expect(parseScaled("5.", 2)).toBe(500n);
    expect(parseScaled("  7 ", 2)).toBe(700n);
    expect(parseScaled("-1.25", 2)).toBe(-125n);
    expect(parseScaled("1.500000", 3)).toBe(1500n); // trailing zeros beyond the scale are harmless
  });

  it("rejects anything that is not a plain number or would lose precision", () => {
    for (const bad of ["", " ", ".", "-", "+", "abc", "1,5", "1e3", "1.2.3", "0x10", "1.0005", "NaN", "Infinity"]) expect(parseScaled(bad, 3), bad).toBeNull();
    expect(parseScaled(null, 2)).toBeNull();
    expect(parseScaled(undefined, 2)).toBeNull();
    expect(parseMoney("1.999")).toBeNull();
    expect(parseQty("0.0001")).toBeNull();
  });

  it("formats with fixed or trimmed decimals", () => {
    expect(formatScaled(1250n, 2)).toBe("12.50");
    expect(formatScaled(5n, 2)).toBe("0.05");
    expect(formatScaled(-5n, 2)).toBe("-0.05");
    expect(formatScaled(0n, 2)).toBe("0.00");
    expect(fmtQty(1500n)).toBe("1.5");
    expect(fmtQty(2000n)).toBe("2");
    expect(fmtQty(100n)).toBe("0.1");
    expect(fmtQty(0n)).toBe("0");
    expect(fmtMoney(1999n)).toBe("19.99");
  });

  it("normalises quantities for sending to the API", () => {
    expect(normaliseQty("1.50")).toBe("1.5");
    expect(normaliseQty("2.000")).toBe("2");
    expect(normaliseQty("1.2345")).toBeNull();
    expect(normaliseQty("x")).toBeNull();
  });
});

describe("rounding matches the server (ROUND_HALF_UP)", () => {
  it("rounds ties away from zero", () => {
    expect(divRound(5n, 10n)).toBe(1n);
    expect(divRound(4n, 10n)).toBe(0n);
    expect(divRound(15n, 10n)).toBe(2n);
    expect(divRound(-5n, 10n)).toBe(-1n);
    expect(divRound(-4n, 10n)).toBe(0n);
  });

  it("computes line totals without floating-point drift", () => {
    expect(lineTotal("10.42", "1.9")).toBe("19.80"); // 19.798 -> 19.80
    expect(lineTotal("12.00", "1.65")).toBe("19.80");
    expect(lineTotal("0.10", "3")).toBe("0.30");
    expect(lineTotal("1.005", "1")).toBeNull(); // not a valid money string
    expect(lineTotal("3.33", "0.5")).toBe("1.67"); // 1.665 rounds up
    expect(lineTotal("2.50", "0.001")).toBe("0.00"); // 0.0025 rounds down to 0.00
    expect(lineTotal("2.50", "0.002")).toBe("0.01"); // 0.005 rounds up
    expect(lineTotal("x", "1")).toBeNull();
    expect(lineTotal("1.00", "")).toBeNull();
  });

  it("is exact where floats are not", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the problem we avoid
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(sumMoney(["19.99", "0.01", null, undefined, ""])).toBe("20.00");
    expect(sumMoney(["1.00", "oops"])).toBeNull();
    expect(subMoney("20.00", "19.99")).toBe("0.01");
    expect(subMoney("1.00", "2.50")).toBe("-1.50");
    expect(subMoney("5.00", null)).toBe("5.00");
    expect(subQty("1.5", "0.25")).toBe("1.25");
  });
});

describe("decimalInput", () => {
  it("accepts a decimal comma from phone keyboards", () => {
    expect(decimalInput("1,62")).toBe("1.62");
    expect(parseQty(decimalInput("1,62"))).toBe(1620n);
    expect(decimalInput("12.5")).toBe("12.5");
  });
});

describe("compareDecimal", () => {
  it("compares across different precisions", () => {
    expect(compareDecimal("1.5", "1.50")).toBe(0);
    expect(compareDecimal("1.65", "1.9")).toBe(-1);
    expect(compareDecimal("10", "9.999")).toBe(1);
    expect(compareDecimal("-0.5", "0")).toBe(-1);
    expect(compareDecimal("a", "1")).toBeNull();
  });
});

describe("toleranceWindow", () => {
  it("matches the server's own example: 1.5 kg at 10% is 1.35 to 1.65", () => {
    expect(toleranceWindow("1.5", "10.00")).toEqual({ min: "1.35", max: "1.65" });
  });
  it("rounds half-up to grams and never goes below zero", () => {
    expect(toleranceWindow("0.333", "10")).toEqual({ min: "0.3", max: "0.366" }); // 0.2997 -> 0.300, 0.3663 -> 0.366
    expect(toleranceWindow("1", "150")).toEqual({ min: "0", max: "2.5" });
    expect(toleranceWindow("2", "0")).toEqual({ min: "2", max: "2" });
    expect(toleranceWindow("2", "7.5")).toEqual({ min: "1.85", max: "2.15" });
  });
  it("returns null for bad input", () => {
    expect(toleranceWindow("x", "10")).toBeNull();
    expect(toleranceWindow("1", "-5")).toBeNull();
  });
});

describe("checkPick", () => {
  const window = { min: "1.35", max: "1.65" };
  const weighed = (raw: string) => checkPick({ raw, ordered: "1.5", weighed: true, window });
  const counted = (raw: string, ordered = "4") => checkPick({ raw, ordered, weighed: false });

  it("accepts anything inside the weight window and charges what was picked", () => {
    expect(weighed("1.62")).toEqual({ status: "full", qty: "1.62", chargedQty: "1.62" });
    expect(weighed("1.35").status).toBe("full");
    expect(weighed("1.65").status).toBe("full");
  });

  it("flags light weights as short and charges what was picked", () => {
    expect(weighed("1.2")).toEqual({ status: "short", qty: "1.2", chargedQty: "1.2" });
  });

  it("flags heavy weights and caps the charge at the window maximum", () => {
    expect(weighed("1.9")).toEqual({ status: "over_window", qty: "1.9", chargedQty: "1.65" });
    expect(weighed("1.651").status).toBe("over_window");
  });

  it("treats counted lines strictly: never above what was ordered", () => {
    expect(counted("4").status).toBe("full");
    expect(counted("3")).toEqual({ status: "short", qty: "3", chargedQty: "3" });
    expect(counted("5")).toEqual({ status: "over_ordered", qty: "5", chargedQty: null });
  });

  it("separates empty, zero and invalid input", () => {
    expect(counted("").status).toBe("empty");
    expect(counted("   ").status).toBe("empty");
    expect(counted("0").status).toBe("zero");
    expect(counted("0.000").status).toBe("zero");
    expect(counted("-1").status).toBe("invalid");
    expect(counted("abc").status).toBe("invalid");
    expect(counted("1.2345").status).toBe("invalid");
    expect(weighed("1,5").status).toBe("invalid");
  });

  it("canonicalises what it will send", () => {
    expect(weighed("1.500").qty).toBe("1.5");
    expect(counted("04").qty).toBe("4");
  });
});

describe("priceImpact", () => {
  it("shows the live difference against the quoted line total, in exact cents", () => {
    // 1.62 kg of a 12.00/kg item vs the 1.5 kg (18.00) the customer was quoted
    expect(priceImpact("12.00", "1.62", "18.00")).toEqual({ charged: "19.44", difference: "1.44" });
    expect(priceImpact("12.00", "1.35", "18.00")).toEqual({ charged: "16.20", difference: "-1.80" });
    expect(priceImpact("12.00", "1.5", "18.00")).toEqual({ charged: "18.00", difference: "0.00" });
    expect(priceImpact("12.00", null, "18.00")).toBeNull();
  });
});

describe("stepper", () => {
  it("steps by whole units for counted lines and by the finest decimal for fractional ones", () => {
    expect(stepFor("4")).toBe("1");
    expect(stepFor("1.5")).toBe("0.1");
    expect(stepFor("0.25")).toBe("0.01");
    expect(stepFor("0.125")).toBe("0.001");
    expect(stepFor("junk")).toBe("1");
  });
  it("moves, clamps at zero and at the maximum, and stays exact", () => {
    expect(stepQty("4", -1, "1")).toBe("3");
    expect(stepQty("0", -1, "1")).toBe("0");
    expect(stepQty("4", 1, "1", "4")).toBe("4");
    expect(stepQty("1.5", 1, "0.1")).toBe("1.6");
    expect(stepQty("0.3", 1, "0.1")).toBe("0.4"); // 0.1 + 0.2 style drift cannot happen
    expect(stepQty("", 1, "1")).toBe("1");
  });
});
