// Newsletter subscribers and the contact-message inbox: shapes and small pure helpers.

export interface SubscriberRow { id: number; email: string; status: "PENDING" | "CONFIRMED" | "UNSUBSCRIBED"; created_at: string; confirmed_at: string | null; unsubscribed_at: string | null }
export interface ContactMessageRow {
  id: number; name: string; email: string; topic: string; message: string; order_number: string; status: "NEW" | "HANDLED";
  handled_by: string | null; handled_at: string | null; staff_note: string; created_at: string;
}

export const CONTACT_TOPICS: [string, string][] = [
  ["ORDER", "An order"], ["DELIVERY", "Delivery or pickup"], ["PRODUCT", "A product"], ["REFUND", "Refund or payment"], ["ACCOUNT", "My account"], ["FEEDBACK", "Feedback"], ["OTHER", "Something else"],
];
export const topicLabel = (v: string) => CONTACT_TOPICS.find(([k]) => k === v)?.[1] ?? v;

export const SUBSCRIBER_STATES: [string, string][] = [["CONFIRMED", "Confirmed"], ["PENDING", "Waiting for confirmation"], ["UNSUBSCRIBED", "Unsubscribed"]];

/** A `mailto:` link that opens the staff member's mail app with a reply started (recipient, subject, the original quoted). */
export function mailtoHref(m: Pick<ContactMessageRow, "email" | "name" | "topic" | "message" | "order_number" | "created_at">, storeName: string, receivedOn: string): string {
  const first = m.name.trim().split(/\s+/)[0] || "there";
  const subject = `Re: your message to ${storeName}${m.order_number ? ` (order ${m.order_number})` : ""}`;
  const quoted = m.message.trim().split("\n").map((l) => `> ${l}`).join("\n");
  const body = `Hi ${first},\n\n\n\nKind regards,\n${storeName}\n\n---\nYou wrote on ${receivedOn} about “${topicLabel(m.topic)}”:\n${quoted}`;
  return `mailto:${encodeURIComponent(m.email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
