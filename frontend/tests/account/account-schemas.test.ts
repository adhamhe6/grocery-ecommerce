import { describe, expect, it } from "vitest";
import { addressSchema, changePasswordSchema, listNameSchema, loginSchema, newPassword, profileSchema, registerSchema, resetPasswordSchema } from "@/lib/account-schemas";

const msgs = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? [] : r.error!.issues.map((i) => i.message));

describe("password rules (mirror the Django validators)", () => {
  it("requires at least 10 characters", () => {
    expect(newPassword.safeParse("short1!").success).toBe(false);
    expect(msgs(newPassword.safeParse("123456789a"))).toEqual([]);
    expect(newPassword.safeParse("a".repeat(9)).success).toBe(false);
    expect(newPassword.safeParse("a".repeat(10)).success).toBe(true);
  });
  it("rejects all-numeric passwords", () => {
    expect(msgs(newPassword.safeParse("1234567890"))).toEqual(["This password is entirely numeric. Add some letters."]);
  });
  it("caps at 128 characters", () => {
    expect(newPassword.safeParse("a".repeat(129)).success).toBe(false);
    expect(newPassword.safeParse("a".repeat(128)).success).toBe(true);
  });
  it("does not trim (spaces are legitimate password characters)", () => {
    expect(newPassword.safeParse("          ").success).toBe(true);
  });
});

describe("loginSchema", () => {
  it("trims the email and requires both fields", () => {
    expect(loginSchema.parse({ email: "  a@b.co ", password: "x" })).toEqual({ email: "a@b.co", password: "x" });
    expect(loginSchema.safeParse({ email: "", password: "" }).success).toBe(false);
    expect(msgs(loginSchema.safeParse({ email: "nope", password: "x" }))).toEqual(["Enter a valid email address, like name@example.com."]);
  });
  it("does not trim or restrict the password", () => {
    expect(loginSchema.parse({ email: "a@b.co", password: " pass " }).password).toBe(" pass ");
  });
});

describe("registerSchema", () => {
  const ok = { full_name: "Ada Lovelace", email: "ada@example.com", phone: "", password: "correct horse battery", marketing_opt_in: false };
  it("accepts a valid sign-up with no phone", () => {
    expect(registerSchema.safeParse(ok).success).toBe(true);
  });
  it("needs a real name (2+ characters after trimming)", () => {
    expect(registerSchema.safeParse({ ...ok, full_name: " A " }).success).toBe(false);
  });
  it("caps phone at 32 characters", () => {
    expect(registerSchema.safeParse({ ...ok, phone: "1".repeat(33) }).success).toBe(false);
  });
});

describe("resetPasswordSchema / changePasswordSchema", () => {
  it("requires the two passwords to match", () => {
    const r = resetPasswordSchema.safeParse({ password: "correct horse battery", confirm: "correct horse batter" });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0].path).toEqual(["confirm"]);
  });
  it("change-password needs the current password", () => {
    const r = changePasswordSchema.safeParse({ current_password: "", new_password: "correct horse battery", confirm: "correct horse battery" });
    expect(msgs(r)).toEqual(["Enter your current password."]);
  });
});

describe("profileSchema", () => {
  it("accepts an optional phone and boolean preferences", () => {
    expect(profileSchema.safeParse({ full_name: "Ada L", phone: "", notify_order_emails: true, marketing_opt_in: false }).success).toBe(true);
  });
});

describe("addressSchema", () => {
  const ok = { label: "", recipient_name: "Ada", phone: "+1 (555) 010-2030", line1: "1 Orchard Row", line2: "", city: "Springfield", area: "", postal_code: "", instructions: "", is_default: false };
  it("accepts the minimum the API needs", () => {
    expect(addressSchema.safeParse(ok).success).toBe(true);
  });
  it("needs at least 6 digits in the phone, like the API", () => {
    expect(addressSchema.safeParse({ ...ok, phone: "12-34" }).success).toBe(false);
    expect(addressSchema.safeParse({ ...ok, phone: "123456" }).success).toBe(true);
  });
  it("enforces the model's field lengths", () => {
    expect(addressSchema.safeParse({ ...ok, label: "x".repeat(41) }).success).toBe(false);
    expect(addressSchema.safeParse({ ...ok, instructions: "x".repeat(301) }).success).toBe(false);
    expect(addressSchema.safeParse({ ...ok, postal_code: "x".repeat(17) }).success).toBe(false);
  });
  it("requires recipient, line 1 and city", () => {
    for (const k of ["recipient_name", "line1", "city"] as const) expect(addressSchema.safeParse({ ...ok, [k]: "  " }).success).toBe(false);
  });
});

describe("listNameSchema", () => {
  it("trims and bounds the name", () => {
    expect(listNameSchema.parse({ name: "  Weekly  " }).name).toBe("Weekly");
    expect(listNameSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(listNameSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
});
