import { describe, expect, it } from "vitest";
import { addDec, cmpDec, decimalPlaces, isDecimal, lineTotal, mulDec, orderTotal, subDec, sumDec, toFixedDec, trimDec } from "@/components/admin/purchasing/decimal";

describe("parsing", () => {
  it("accepts plain decimal strings only", () => {
    for (const ok of ["0", "12", "12.5", "0.001", "-3.25", "+2", ".5", "007.10"]) expect(isDecimal(ok), ok).toBe(true);
    for (const bad of ["", " ", ".", "-", "1e3", "1,5", "abc", "1.2.3", "NaN", "Infinity", "--1"]) expect(isDecimal(bad), bad).toBe(false);
    expect(isDecimal(null)).toBe(false);
    expect(isDecimal(undefined)).toBe(false);
  });
  it("counts decimal places", () => {
    expect(decimalPlaces("12")).toBe(0);
    expect(decimalPlaces("12.340")).toBe(3);
    expect(decimalPlaces("nope")).toBe(0);
  });
});

describe("exact arithmetic (no float drift)", () => {
  it("adds and subtracts exactly", () => {
    expect(addDec("0.1", "0.2")).toBe("0.3"); // 0.1 + 0.2 !== 0.3 with floats
    expect(subDec("1", "0.9")).toBe("0.1");
    expect(subDec("5", "7.5")).toBe("-2.5");
    expect(addDec("1.250", "2.750")).toBe("4");
    expect(addDec("x", "1")).toBeNull();
  });
  it("multiplies exactly", () => {
    expect(mulDec("1.1", "1.1")).toBe("1.21");
    expect(mulDec("0.125", "8")).toBe("1");
    expect(mulDec("19.99", "3")).toBe("59.97");
    expect(mulDec("-2", "0.5")).toBe("-1");
    expect(mulDec("", "2")).toBeNull();
  });
  it("compares numerically, not lexically", () => {
    expect(cmpDec("9", "10")).toBe(-1);
    expect(cmpDec("2.50", "2.5")).toBe(0);
    expect(cmpDec("0.001", "0")).toBe(1);
    expect(cmpDec("-1", "-2")).toBe(1);
    expect(cmpDec("a", "1")).toBeNull();
  });
  it("trims trailing zeros like the API's quantity strings", () => {
    expect(trimDec("3.000")).toBe("3");
    expect(trimDec("0.250")).toBe("0.25");
    expect(trimDec("10")).toBe("10");
    expect(trimDec("-0.50")).toBe("-0.5");
    expect(trimDec("n/a")).toBe("n/a");
  });
});

describe("rounding (ROUND_HALF_UP, ties away from zero)", () => {
  it("rounds .5 up", () => {
    expect(toFixedDec("1.005", 2)).toBe("1.01"); // floats give 1.00
    expect(toFixedDec("2.675", 2)).toBe("2.68"); // floats give 2.67
    expect(toFixedDec("0.004", 2)).toBe("0.00");
    expect(toFixedDec("0.005", 2)).toBe("0.01");
  });
  it("rounds negative ties away from zero and never prints -0.00", () => {
    expect(toFixedDec("-1.005", 2)).toBe("-1.01");
    expect(toFixedDec("-0.001", 2)).toBe("0.00");
  });
  it("pads to the requested scale", () => {
    expect(toFixedDec("5", 2)).toBe("5.00");
    expect(toFixedDec("5.1", 2)).toBe("5.10");
  });
});

describe("purchase order totals", () => {
  it("a line is the exact product rounded to cents", () => {
    expect(lineTotal("20", "1.10")).toBe("22.00");
    expect(lineTotal("0.333", "3")).toBe("1.00"); // 0.999
    expect(lineTotal("1.5", "2.3333")).toBe("3.50"); // 3.49995
    expect(lineTotal("", "2")).toBeNull();
    expect(lineTotal("2", "x")).toBeNull();
  });

  it("matches the backend example: 40 x 1.10 + 20 x 1.90 = 82.00", () => {
    expect(orderTotal([{ qty: "40", unitCost: "1.10" }, { qty: "20", unitCost: "1.90" }])).toBe("82.00");
  });

  it("rounds once on the exact sum, as the server does, not line by line", () => {
    // Each line is 0.004 (rounds to 0.00 on its own); ten of them are exactly 0.04.
    const lines = Array.from({ length: 10 }, () => ({ qty: "1", unitCost: "0.004" }));
    expect(orderTotal(lines)).toBe("0.04");
    // Two lines of 0.005 each round to 0.01 individually (0.02) but the exact sum 0.010 rounds to 0.01.
    expect(orderTotal([{ qty: "1", unitCost: "0.005" }, { qty: "1", unitCost: "0.005" }])).toBe("0.01");
  });

  it("does not accumulate float error over many lines", () => {
    const lines = Array.from({ length: 1000 }, () => ({ qty: "3", unitCost: "0.1" }));
    expect(orderTotal(lines)).toBe("300.00");
  });

  it("handles 3-dp quantities with 4-dp costs", () => {
    expect(orderTotal([{ qty: "12.345", unitCost: "1.2345" }])).toBe("15.24"); // 15.2393025
  });

  it("ignores incomplete or invalid rows while the form is being filled in", () => {
    expect(orderTotal([])).toBe("0.00");
    expect(orderTotal([{ qty: "", unitCost: "2" }, { qty: "3", unitCost: "abc" }, { qty: "2", unitCost: "1.50" }])).toBe("3.00");
  });

  it("sums quantities exactly", () => {
    expect(sumDec(["0.1", "0.2", "0.3"])).toBe("0.6");
    expect(sumDec(["1.500", "bad", "2"])).toBe("3.5");
    expect(sumDec([])).toBe("0");
  });
});
