import { describe, expect, it } from "vitest";
import { parseApiResponse } from "@/components/admin/catalog/upload";
import { ApiError } from "@/lib/api";

describe("parseApiResponse (upload results)", () => {
  it("returns the created record", () => expect(parseApiResponse(201, '{"id":5,"alt_text":"x"}')).toEqual({ id: 5, alt_text: "x" }));
  it("treats 204 as success with no body", () => expect(parseApiResponse(204, "")).toBeUndefined());
  it("turns the error envelope into an ApiError whose field errors name the file field", () => {
    try {
      parseApiResponse(400, JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "Check the highlighted fields.", details: { image: ["Image is too large (max 5 MB)."] }, request_id: "r1" } }));
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.status).toBe(400);
      expect(err.fieldErrors).toEqual({ image: "Image is too large (max 5 MB)." });
      expect(err.requestId).toBe("r1");
    }
  });
  it("copes with a non-JSON failure (for example a proxy error page)", () => {
    expect(() => parseApiResponse(502, "<html>Bad gateway</html>")).toThrowError(/Something went wrong/);
  });
});
