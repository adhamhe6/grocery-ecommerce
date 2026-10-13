import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFINITIONS, DEFINITIONS_INTRO, REPORT_NOTES } from "@/components/admin/reports/report-meta";

// The Definitions panel must say what the backend says. Compare against the docstring at the top of queries.py
// (skipped automatically when the backend folder isn't checked out next to the frontend).
const QUERIES = path.resolve(process.cwd(), "../backend/apps/reports/queries.py");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe.skipIf(!fs.existsSync(QUERIES))("report definitions match backend/apps/reports/queries.py", () => {
  const source = fs.readFileSync(QUERIES, "utf8");
  const doc = norm(source.match(/^"""([\s\S]*?)"""/)?.[1] ?? "");

  it("copies the intro sentence", () => {
    expect(doc).toContain(norm(DEFINITIONS_INTRO));
  });
  it("copies every definition word for word", () => {
    for (const d of DEFINITIONS) expect(doc, d.term).toContain(norm(`${d.term} – ${d.text}`));
  });
  it("has no definition the panel is missing", () => {
    const bullets = (source.match(/^"""([\s\S]*?)"""/)?.[1] ?? "").split("\n").filter((l) => /^\* \S/.test(l));
    expect(bullets).toHaveLength(DEFINITIONS.length);
  });
  it("has notes for exactly the reports the backend registers", () => {
    const registry = source.slice(source.indexOf("REPORTS = {"));
    const keys = [...registry.matchAll(/^\s{4}"([a-z-]+)": \(/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(5);
    expect(Object.keys(REPORT_NOTES).sort()).toEqual([...keys].sort());
  });
});
