// Response shapes of the staff store / delivery API (backend/apps/stores/admin_api.py).
import type { ApiHours } from "./hours";

export interface Branch {
  id: number;
  code: string;
  name: string;
  slug: string;
  address_line1: string;
  address_line2: string;
  city: string;
  area: string;
  postal_code: string;
  phone: string;
  email: string;
  timezone: string;
  is_active: boolean;
  is_default: boolean;
  offers_delivery: boolean;
  offers_pickup: boolean;
  prep_minutes: number;
  pickup_instructions: string;
  hours: ApiHours[];
  is_demo: boolean;
}

export interface Closure { id: number; branch: number; date: string; reason: string }

export interface Zone {
  id: number;
  branch: number;
  name: string;
  postcode_prefixes: string[];
  areas: string[];
  delivery_fee: string;
  free_delivery_threshold: string | null;
  min_order_value: string;
  priority: number;
  is_active: boolean;
}

export type SlotKind = "DELIVERY" | "PICKUP";
export interface SlotTemplate {
  id: number;
  branch: number;
  zone: number | null;
  kind: SlotKind;
  weekday: number;
  start_time: string;
  end_time: string;
  capacity: number;
  fee: string | null;
  is_active: boolean;
}
