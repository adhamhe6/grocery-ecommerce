import { describe, expect, it } from "vitest";
import { slugify, splitList, templateErrors, templatePayload, validateMoney, validateTimeZone, validateWholeNumber, zoneErrors, zonePayload, type TemplateForm, type ZoneForm } from "@/components/admin/delivery/forms";

describe("validators", () => {
  it("money: two decimals, not negative", () => {
    expect(validateMoney("3.50")).toBeNull();
    expect(validateMoney("0")).toBeNull();
    expect(validateMoney("")).toBeNull();
    expect(validateMoney("", { required: true })).toBeDefined();
    expect(validateMoney("3.505")).toMatch(/two decimal/);
    expect(validateMoney("-1")).toMatch(/negative/);
    expect(validateMoney("abc")).toBeDefined();
  });
  it("whole numbers with bounds", () => {
    expect(validateWholeNumber("120", { min: 0 })).toBeNull();
    expect(validateWholeNumber("1.5")).toBeDefined();
    expect(validateWholeNumber("-1")).toBeDefined();
    expect(validateWholeNumber("0", { min: 1, label: "capacity" })).toMatch(/at least 1/);
  });
  it("timezone: blank or a real IANA name", () => {
    expect(validateTimeZone("")).toBeNull();
    expect(validateTimeZone("Europe/London")).toBeNull();
    expect(validateTimeZone("Mars/Olympus")).toMatch(/known timezone/);
  });
  it("splits lists on commas, semicolons and new lines", () => {
    expect(splitList("RW3, RW4\nRW5;; ")).toEqual(["RW3", "RW4", "RW5"]);
    expect(splitList("   ")).toEqual([]);
  });
  it("slugifies", () => {
    expect(slugify("Central Market!")).toBe("central-market");
    expect(slugify("  --Ünï--  ")).toBe("n");
  });
});

const zone = (over: Partial<ZoneForm> = {}): ZoneForm => ({ branch: 1, name: "Inner", postcodes: "RW3, RW4", areas: "", fee: "3.50", freeOver: "", minOrder: "0", priority: "100", active: true, ...over });

describe("zone form", () => {
  it("is valid with coverage, fee and priority", () => {
    expect(zoneErrors(zone(), true)).toEqual({});
  });
  it("needs coverage when creating (the API only checks this on create)", () => {
    expect(zoneErrors(zone({ postcodes: "", areas: "" }), true).postcodes).toBeDefined();
    expect(zoneErrors(zone({ postcodes: "", areas: "" }), false).postcodes).toBeUndefined();
    expect(zoneErrors(zone({ postcodes: "", areas: "old town" }), true)).toEqual({});
  });
  it("checks money fields and priority", () => {
    const e = zoneErrors(zone({ fee: "", freeOver: "-5", minOrder: "1.234", priority: "x" }), true);
    expect(Object.keys(e).sort()).toEqual(["fee", "freeOver", "minOrder", "priority"]);
  });
  it("builds the request body; a blank free-delivery threshold means none", () => {
    expect(zonePayload(zone({ postcodes: "rw 3, RW4", areas: "Old Town" }))).toEqual({
      branch: 1, name: "Inner", postcode_prefixes: ["rw 3", "RW4"], areas: ["Old Town"], delivery_fee: "3.50", free_delivery_threshold: null, min_order_value: "0", priority: 100, is_active: true,
    });
    expect(zonePayload(zone({ freeOver: "40" })).free_delivery_threshold).toBe("40");
  });
});

const tpl = (over: Partial<TemplateForm> = {}): TemplateForm => ({ branch: 1, kind: "DELIVERY", zone: 2, weekday: 1, start: "09:00", end: "11:00", capacity: "6", fee: "", active: true, ...over });

describe("slot template form", () => {
  it("is valid for a normal delivery template", () => {
    expect(templateErrors(tpl())).toEqual({});
  });
  it("needs a zone for delivery but not for pickup", () => {
    expect(templateErrors(tpl({ zone: null })).zone).toBeDefined();
    expect(templateErrors(tpl({ kind: "PICKUP", zone: null }))).toEqual({});
  });
  it("needs start before end and positive capacity", () => {
    expect(templateErrors(tpl({ start: "12:00", end: "11:00" })).end).toMatch(/before it ends/);
    expect(templateErrors(tpl({ start: "11:00", end: "11:00" })).end).toBeDefined();
    expect(templateErrors(tpl({ capacity: "0" })).capacity).toBeDefined();
  });
  it("sends no zone for pickup and no fee when blank (the zone fee then applies)", () => {
    expect(templatePayload(tpl({ kind: "PICKUP", zone: 2 }))).toMatchObject({ kind: "PICKUP", zone: null, fee: null });
    expect(templatePayload(tpl({ fee: "4.50" }))).toMatchObject({ kind: "DELIVERY", zone: 2, fee: "4.50", capacity: 6, start_time: "09:00" });
  });
});
