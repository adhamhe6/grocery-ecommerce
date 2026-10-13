import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { applyApiErrors, parseApiFormErrors, waitText } from "@/lib/form-errors";

const err = (status: number, code: string, message: string, details: Record<string, unknown> | unknown[] = {}) => new ApiError(status, code, message, details as Record<string, unknown>);

describe("parseApiFormErrors", () => {
  it("maps serializer validation errors to their fields", () => {
    const e = err(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", { email: ["An account with this email already exists. Try signing in instead."], full_name: ["Please enter your full name."] });
    expect(parseApiFormErrors(e, { fields: ["email", "full_name", "password"] })).toEqual({
      fields: { email: "An account with this email already exists. Try signing in instead.", full_name: "Please enter your full name." },
      form: null,
    });
  });

  it("joins several messages for one field", () => {
    const e = err(400, "VALIDATION_ERROR", "x", { new_password: ["This password is too short.", "This password is too common."] });
    expect(parseApiFormErrors(e).fields.new_password).toBe("This password is too short. This password is too common.");
  });

  it("sends non_field_errors to the requested field (password rules are raised from validate())", () => {
    const e = err(400, "VALIDATION_ERROR", "x", { non_field_errors: ["This password is too common.", "This password is entirely numeric."] });
    expect(parseApiFormErrors(e, { fields: ["password"], nonFieldTo: "password" })).toEqual({ fields: { password: "This password is too common. This password is entirely numeric." }, form: null });
  });

  it("shows non_field_errors at form level when no target is given", () => {
    const e = err(400, "VALIDATION_ERROR", "x", { non_field_errors: ["Something is off."] });
    expect(parseApiFormErrors(e)).toEqual({ fields: {}, form: "Something is off." });
  });

  it("handles the array shape used by the password-reset confirm view", () => {
    const e = err(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", ["This password is too short. It must contain at least 10 characters."]);
    expect(parseApiFormErrors(e, { fields: ["password"], nonFieldTo: "password" })).toEqual({ fields: { password: "This password is too short. It must contain at least 10 characters." }, form: null });
    expect(parseApiFormErrors(e).form).toBe("This password is too short. It must contain at least 10 characters.");
  });

  it("does not lose messages for fields the form doesn't have", () => {
    const e = err(400, "VALIDATION_ERROR", "x", { email: ["Bad email."], role: ["Not allowed."] });
    expect(parseApiFormErrors(e, { fields: ["email"] })).toEqual({ fields: { email: "Bad email." }, form: "Not allowed." });
  });

  it("falls back to the message for domain errors", () => {
    const e = err(401, "INVALID_CREDENTIALS", "That email and password don't match. Please try again.");
    expect(parseApiFormErrors(e, { fields: ["email", "password"] })).toEqual({ fields: {}, form: "That email and password don't match. Please try again." });
  });

  it("adds the wait time to rate-limit errors", () => {
    const e = err(429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again.", { retry_after: 1800 });
    expect(parseApiFormErrors(e).form).toBe("Too many requests. Please wait a moment and try again. You can try again in about 30 minutes.");
  });

  it("ignores numeric details instead of rendering them", () => {
    const e = err(429, "RATE_LIMITED", "Slow down.", { retry_after: 0 });
    expect(parseApiFormErrors(e)).toEqual({ fields: {}, form: "Slow down." });
  });

  it("gives a generic message for anything that isn't an ApiError", () => {
    expect(parseApiFormErrors(new TypeError("boom")).form).toBe("Something went wrong. Please try again.");
    expect(parseApiFormErrors("nope").fields).toEqual({});
  });

  it("surfaces network errors", () => {
    const e = err(0, "NETWORK_ERROR", "We couldn't reach the server. Check your connection and try again.");
    expect(parseApiFormErrors(e).form).toMatch(/couldn't reach the server/);
  });
});

describe("waitText", () => {
  it("reads naturally", () => {
    expect(waitText(30)).toBe("a minute");
    expect(waitText(600)).toBe("about 10 minutes");
    expect(waitText(3600)).toBe("about 60 minutes");
    expect(waitText(7200)).toBe("about 2 hours");
  });
});

describe("applyApiErrors", () => {
  it("sets field errors, focuses the first one and reports the form message", () => {
    const setError = vi.fn();
    const setForm = vi.fn();
    applyApiErrors(err(400, "VALIDATION_ERROR", "x", { phone: ["Bad phone."], line1: ["Required."] }), setError as never, setForm, { fields: ["phone", "line1"] });
    expect(setError).toHaveBeenNthCalledWith(1, "phone", { type: "server", message: "Bad phone." }, { shouldFocus: true });
    expect(setError).toHaveBeenNthCalledWith(2, "line1", { type: "server", message: "Required." }, { shouldFocus: false });
    expect(setForm).toHaveBeenCalledWith(null);
  });

  it("reports a form message when there are no fields", () => {
    const setError = vi.fn();
    const setForm = vi.fn();
    applyApiErrors(err(409, "INVALID_STATE", "Nope."), setError as never, setForm);
    expect(setError).not.toHaveBeenCalled();
    expect(setForm).toHaveBeenCalledWith("Nope.");
  });
});
