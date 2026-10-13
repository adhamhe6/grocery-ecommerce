"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import * as React from "react";
import { Pager } from "@/components/admin/kit";
import { EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { columnKind, formatCell, isNumericKind, sortRows, type CellFormat, type ReportColumn, type ReportRow } from "./report-format";

const PAGE_SIZE = 50;

/**
 * Generic table for any report: columns come from the API, cells are formatted by the column's kind, numbers are
 * right-aligned. Sorting and paging happen in the browser over the rows the API returned.
 */
export function ReportTable({ caption, columns, rows, format, empty }: { caption: string; columns: ReportColumn[]; rows: ReportRow[]; format: CellFormat; empty: React.ReactNode }) {
  const [sort, setSort] = React.useState<{ key: string; desc: boolean } | null>(null);
  const [page, setPage] = React.useState(1);
  const sorted = React.useMemo(() => (sort ? sortRows(rows, columns.find((c) => c.key === sort.key), sort.desc) : rows), [rows, columns, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  React.useEffect(() => setPage(1), [rows]);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-line bg-white shadow-sm">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line bg-paper-2/60 text-xs uppercase tracking-wide text-ink-3">
            <tr>
              {columns.map((c) => {
                const numeric = isNumericKind(columnKind(c));
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" className={cn("whitespace-nowrap px-4 py-3 font-semibold", numeric && "text-right")} aria-sort={active ? (sort!.desc ? "descending" : "ascending") : undefined}>
                    <button type="button" className={cn("inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink", numeric && "flex-row-reverse")} onClick={() => setSort(active && !sort!.desc ? { key: c.key, desc: true } : { key: c.key, desc: false })}>
                      {c.label}
                      {active && (sort!.desc ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
                      <span className="sr-only">, sort {active && !sort!.desc ? "descending" : "ascending"}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.map((row, i) => (
              <tr key={(current - 1) * PAGE_SIZE + i} className="align-top">
                {columns.map((c) => {
                  const kind = columnKind(c);
                  const text = formatCell(kind, row[c.key], format);
                  return <td key={c.key} className={cn("px-4 py-2.5", isNumericKind(kind) && "num whitespace-nowrap text-right", text === "—" && "text-ink-3")}>{text}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="border-t border-line">{empty}</div>}
      </div>
      {rows.length > 0 && <Pager page={current} totalPages={pages} count={rows.length} onPage={setPage} label={rows.length === 1 ? "row" : "rows"} />}
    </div>
  );
}

export function NoRows() {
  return <EmptyState title="Nothing to report for this period">There is no data for this range and store. Try a longer period or another store.</EmptyState>;
}
