import { closeDb } from "./support/db";

export default async function globalTeardown() {
  await closeDb();
}
