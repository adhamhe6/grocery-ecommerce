import { describe, expect, it } from "vitest";
import { moveItem } from "@/components/admin/catalog/form-kit";
import { brandPayload, categoryPayload, collectionPayload, collectionState, emptyBrand, emptyCategory, emptyCollection, intOrRaw, planSortOrder } from "@/components/admin/catalog/taxonomy-model";

describe("moveItem", () => {
  it("moves by one place and clamps at the ends", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    const same = ["a", "b"];
    expect(moveItem(same, 0, -1)).toBe(same);
    expect(moveItem(same, 1, 1)).toBe(same);
  });
});

describe("planSortOrder", () => {
  it("separates items that all share the default sort order on the first move", () => {
    const items = [{ id: 1, sort_order: 100 }, { id: 2, sort_order: 100 }, { id: 3, sort_order: 100 }];
    expect(planSortOrder(items, 2, -1)).toEqual([{ id: 1, sort_order: 10 }, { id: 3, sort_order: 20 }, { id: 2, sort_order: 30 }]);
  });
  it("returns only the rows whose number changes", () => {
    const items = [{ id: 1, sort_order: 10 }, { id: 2, sort_order: 20 }, { id: 3, sort_order: 30 }];
    expect(planSortOrder(items, 0, 1)).toEqual([{ id: 2, sort_order: 10 }, { id: 1, sort_order: 20 }]);
  });
  it("does nothing at the edges", () => {
    const items = [{ id: 1, sort_order: 10 }, { id: 2, sort_order: 20 }];
    expect(planSortOrder(items, 0, -1)).toEqual([]);
    expect(planSortOrder(items, 1, 1)).toEqual([]);
  });
});

describe("collectionState", () => {
  const base = { is_active: true, is_current: false, starts_on: null as string | null };
  it("labels the lifecycle", () => {
    expect(collectionState({ ...base, is_active: false }, "2026-10-12")).toBe("Off");
    expect(collectionState({ ...base, is_current: true }, "2026-10-12")).toBe("Live");
    expect(collectionState({ ...base, starts_on: "2026-11-01" }, "2026-10-12")).toBe("Scheduled");
    expect(collectionState({ ...base, starts_on: "2026-09-01" }, "2026-10-12")).toBe("Ended");
  });
});

describe("taxonomy payloads", () => {
  it("builds a category body: department is null, slug only when typed", () => {
    const f = emptyCategory();
    f.name = " Dairy ";
    expect(categoryPayload(f)).toEqual({ name: "Dairy", parent: null, description: "", sort_order: 100, is_active: true, show_on_home: false });
    expect(categoryPayload({ ...f, parent: "4", slug: " dairy-eggs ", sortOrder: "30" })).toMatchObject({ parent: 4, slug: "dairy-eggs", sort_order: 30 });
  });
  it("lets the API judge a non-numeric sort order", () => expect(intOrRaw("abc")).toBe("abc"));
  it("builds brand and collection bodies; empty dates are null", () => {
    expect(brandPayload({ ...emptyBrand(), name: " Green Valley " })).toEqual({ name: "Green Valley", description: "", is_active: true });
    expect(collectionPayload({ ...emptyCollection(), name: "BBQ", startsOn: "2026-06-01" })).toMatchObject({ name: "BBQ", starts_on: "2026-06-01", ends_on: null, sort_order: 100 });
  });
});
