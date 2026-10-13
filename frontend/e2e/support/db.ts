import { Pool } from "pg";

// Direct, read-only access to the application database so a spec can prove what was *persisted*, not just what was shown.
const url = process.env.E2E_DATABASE_URL ?? "postgres://grocery:grocery@127.0.0.1:5432/grocery_e2e";
export const pool = new Pool({ connectionString: url, max: 2 });

export async function one<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await pool.query(sql, params);
  if (r.rows.length !== 1) throw new Error(`Expected exactly one row, got ${r.rows.length} for: ${sql}`);
  return r.rows[0] as T;
}

export async function rows<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

export const num = (v: unknown) => Number(v);
export const cents = (v: unknown) => Math.round(Number(v) * 100);

export async function stock(productSlug: string, branchCode = "central") {
  return one<{ on_hand: string; reserved: string }>(
    `SELECT sl.on_hand, sl.reserved FROM inventory_stocklevel sl
       JOIN catalog_product p ON p.id = sl.product_id JOIN stores_branch b ON b.id = sl.branch_id
      WHERE p.slug = $1 AND b.code = $2`,
    [productSlug, branchCode],
  );
}

export async function orderByNumber(number: string) {
  return one<Record<string, any>>("SELECT * FROM orders_order WHERE number = $1", [number]);
}

export async function closeDb() {
  await pool.end();
}
