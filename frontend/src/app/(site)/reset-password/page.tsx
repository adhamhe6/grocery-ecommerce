import { redirect } from "next/navigation";

// The emailed link points at /account/reset-password; this short URL forwards there and keeps uid and token.
type SP = Record<string, string | string[] | undefined>;

export default async function ResetPasswordAlias({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const key of ["uid", "token"]) {
    const v = Array.isArray(sp[key]) ? sp[key][0] : sp[key];
    if (v) qs.set(key, v);
  }
  redirect(`/account/reset-password${qs.size ? `?${qs}` : ""}`);
}
