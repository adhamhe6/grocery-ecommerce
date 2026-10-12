"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, describedBy } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { ApiError, apiPost } from "@/lib/api";

/** Topics accepted by `POST /contact/` (ContactMessage.Topic in the backend). */
export const CONTACT_TOPICS: [string, string][] = [
  ["ORDER", "An order"],
  ["DELIVERY", "Delivery or pickup"],
  ["PRODUCT", "A product"],
  ["REFUND", "Refund or payment"],
  ["ACCOUNT", "My account"],
  ["FEEDBACK", "Feedback"],
  ["OTHER", "Something else"],
];

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 3000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Values { name: string; email: string; topic: string; message: string; order_number: string }
type Errors = Partial<Record<keyof Values, string>>;

function validate(v: Values): Errors {
  const e: Errors = {};
  if (v.name.trim().length < 2) e.name = "Please tell us your name.";
  if (!v.email.trim()) e.email = "Enter your email address so we can reply.";
  else if (!EMAIL.test(v.email.trim())) e.email = "Enter a valid email address.";
  if (v.message.trim().length < MESSAGE_MIN) e.message = `Please write at least ${MESSAGE_MIN} characters.`;
  return e;
}

export function ContactForm() {
  const id = React.useId();
  const [values, setValues] = React.useState<Values>({ name: "", email: "", topic: "OTHER", message: "", order_number: "" });
  const [errors, setErrors] = React.useState<Errors>({});
  const formRef = React.useRef<HTMLFormElement>(null);
  const doneRef = React.useRef<HTMLHeadingElement>(null);
  const focusFirstInvalid = () => window.setTimeout(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(), 0);
  const send = useMutation({
    mutationFn: (v: Values) => apiPost<{ detail: string }>("/contact/", { ...v, name: v.name.trim(), email: v.email.trim(), message: v.message.trim(), order_number: v.order_number.trim() }),
  });
  const apiError = send.error instanceof ApiError ? send.error : null;
  const hasFieldErrors = Object.values(errors).some(Boolean);
  const isValidationError = !!apiError && apiError.status === 400 && Object.keys(apiError.fieldErrors).length > 0;

  React.useEffect(() => {
    if (send.isSuccess) doneRef.current?.focus();
  }, [send.isSuccess]);

  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    setErrors((c) => ({ ...c, [k]: undefined }));
  };

  if (send.isSuccess) {
    return (
      <div aria-live="polite" className="rounded-lg border border-ok/25 bg-ok-soft p-6">
        <h2 ref={doneRef} tabIndex={-1} className="flex items-center gap-2 text-2xl focus:outline-none"><CheckCircle2 className="size-6 text-ok" aria-hidden /> Message sent</h2>
        <p className="mt-2 text-ink">{send.data.detail}</p>
        <p className="mt-1 text-sm text-ink-2">We&apos;ll reply to {values.email.trim()}. Check your spam folder if you don&apos;t hear from us.</p>
        <Button className="mt-5" variant="secondary" onClick={() => { send.reset(); setErrors({}); setValues({ name: "", email: "", topic: "OTHER", message: "", order_number: "" }); }}>Send another message</Button>
      </div>
    );
  }

  const field = (k: keyof Values) => ({ id: `${id}-${k}`, "aria-invalid": !!errors[k], "aria-describedby": describedBy(`${id}-${k}`, k === "email" || k === "message" || k === "order_number", !!errors[k]) });

  return (
    <form
      ref={formRef} noValidate className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const found = validate(values);
        setErrors(found);
        if (Object.keys(found).length > 0) return focusFirstInvalid();
        send.mutate(values, {
          onError: (err) => {
            if (err instanceof ApiError) setErrors(err.fieldErrors as Errors);
            focusFirstInvalid();
          },
        });
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Your name" htmlFor={`${id}-name`} required error={errors.name}>
          <Input {...field("name")} name="name" autoComplete="name" required maxLength={120} value={values.name} onChange={set("name")} />
        </Field>
        <Field label="Email address" htmlFor={`${id}-email`} required error={errors.email} hint="We reply by email, so please check this is right.">
          <Input {...field("email")} name="email" type="email" autoComplete="email" required maxLength={254} value={values.email} onChange={set("email")} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="What is it about?" htmlFor={`${id}-topic`} error={errors.topic}>
          <Select {...field("topic")} name="topic" value={values.topic} onChange={set("topic")}>
            {CONTACT_TOPICS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <Field label="Order number (optional)" htmlFor={`${id}-order_number`} error={errors.order_number} hint="If your message is about an order, adding the number helps us find it.">
          <Input {...field("order_number")} name="order_number" autoComplete="off" autoCapitalize="characters" maxLength={20} value={values.order_number} onChange={set("order_number")} />
        </Field>
      </div>
      <Field label="Your message" htmlFor={`${id}-message`} required error={errors.message} hint={<span className="num">{values.message.length} / {MESSAGE_MAX} characters</span>}>
        <Textarea {...field("message")} name="message" required rows={7} maxLength={MESSAGE_MAX} value={values.message} onChange={set("message")} />
      </Field>

      <div aria-live="polite" aria-atomic="true">
        {send.isError && (!isValidationError || hasFieldErrors) && (
          <Alert tone="bad" title="Your message wasn't sent">
            {isValidationError ? "Please correct the highlighted fields and try again." : apiError ? apiError.message : "Something went wrong. Please try again."}
          </Alert>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" loading={send.isPending}>Send message</Button>
        <p className="text-sm text-ink-3">Replies come by email. This form doesn&apos;t give an instant answer.</p>
      </div>
    </form>
  );
}
