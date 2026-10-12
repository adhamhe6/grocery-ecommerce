// Client-side validation for account forms. Each rule mirrors something the API enforces, so the shopper hears about
// it before the round trip; the API stays the source of truth and its messages are shown when it disagrees.

import { z } from "zod";

// backend: AUTH_PASSWORD_VALIDATORS (min length 10, common-password list, not entirely numeric, not similar to name/email)
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const PASSWORD_HINT = `Use at least ${PASSWORD_MIN} characters. We turn down very common passwords, passwords made only of numbers, and ones too similar to your name or email.`;

const email = z.string().trim().min(1, "Enter your email address.").max(254, "That email address is too long.").email("Enter a valid email address, like name@example.com.");

export const newPassword = z
  .string()
  .min(1, "Choose a password.")
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use ${PASSWORD_MAX} characters or fewer.`)
  .refine((v) => !/^\d+$/.test(v), "This password is entirely numeric. Add some letters.");

const fullName = z.string().trim().min(2, "Please enter your full name.").max(120, "That name is too long (120 characters at most).");
const optionalPhone = z.string().trim().max(32, "Use 32 characters or fewer.");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  full_name: fullName,
  email,
  phone: optionalPhone,
  password: newPassword,
  marketing_opt_in: z.boolean(),
});
export type RegisterValues = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({ password: newPassword, confirm: z.string().min(1, "Type the new password again.") })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The two passwords don't match." });
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export const profileSchema = z.object({
  full_name: fullName,
  phone: optionalPhone,
  notify_order_emails: z.boolean(),
  marketing_opt_in: z.boolean(),
});
export type ProfileValues = z.infer<typeof profileSchema>;

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password."),
    new_password: newPassword,
    confirm: z.string().min(1, "Type the new password again."),
  })
  .refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "The two passwords don't match." });
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

const digits = (s: string) => s.replace(/\D/g, "").length;

// backend: AddressSerializer (phone needs at least 6 digits); field lengths come from the Address model
export const addressSchema = z.object({
  label: z.string().trim().max(40, "Use 40 characters or fewer."),
  recipient_name: z.string().trim().min(1, "Enter the name of the person receiving the delivery.").max(120, "Use 120 characters or fewer."),
  phone: z.string().trim().min(1, "Enter a phone number we can reach you on.").max(32, "Use 32 characters or fewer.").refine((v) => digits(v) >= 6, "Enter a phone number we can reach you on."),
  line1: z.string().trim().min(1, "Enter the first line of the address.").max(160, "Use 160 characters or fewer."),
  line2: z.string().trim().max(160, "Use 160 characters or fewer."),
  city: z.string().trim().min(1, "Enter the town or city.").max(80, "Use 80 characters or fewer."),
  area: z.string().trim().max(80, "Use 80 characters or fewer."),
  postal_code: z.string().trim().max(16, "Use 16 characters or fewer."),
  instructions: z.string().trim().max(300, "Use 300 characters or fewer."),
  is_default: z.boolean(),
});
export type AddressValues = z.infer<typeof addressSchema>;

export const listNameSchema = z.object({ name: z.string().trim().min(1, "Give the list a name.").max(80, "Use 80 characters or fewer.") });
export type ListNameValues = z.infer<typeof listNameSchema>;
