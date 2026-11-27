import type { Key, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type DataTableColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Takes the remaining width. Table mode truncates each child line; card mode wraps them. */
  grow?: boolean;
  /**
   * With `grow`: wraps in table mode too, instead of truncating. For text that must be read in
   * full, such as notes and reasons; keep the other columns few and narrow so it has room.
   */
  wrap?: boolean;
  /** Full text for the cell's `title`, so truncated values stay readable on hover. */
  title?: (row: T) => string;
  /** `end` right-aligns the cell in table mode only. */
  align?: "start" | "end";
  /** Keeps the header for screen readers only (e.g. an actions column). */
  hideHeader?: boolean;
  /** Shows the header above the value in card mode. Defaults to `!hideHeader`. */
  stackedLabel?: boolean;
};

/**
 * Record list that is a table when its container is at least 42rem wide and a stack of cards
 * below that. Explicit roles keep table semantics in card mode, where the display changes.
 */
export function DataTable<T>({
  label,
  rows,
  rowKey,
  columns,
}: {
  label: string;
  rows: readonly T[];
  rowKey: (row: T) => Key;
  columns: readonly DataTableColumn<T>[];
}) {
  return (
    <div className="@container/data-table">
      <div className="@2xl/data-table:overflow-hidden @2xl/data-table:rounded-xl @2xl/data-table:bg-card @2xl/data-table:text-card-foreground @2xl/data-table:ring-1 @2xl/data-table:ring-foreground/10">
        <table role="table" aria-label={label} className="block w-full text-sm @2xl/data-table:table">
          <thead role="rowgroup" className="sr-only @2xl/data-table:not-sr-only @2xl/data-table:table-header-group">
            <tr role="row" className="border-b">
              {columns.map((column) => (
                <th
                  key={column.id}
                  role="columnheader"
                  scope="col"
                  className={cn(
                    "h-10 px-4 text-left align-middle font-medium whitespace-nowrap text-foreground",
                    column.align === "end" && "text-right",
                  )}
                >
                  {column.hideHeader ? <span className="sr-only">{column.header}</span> : column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup" className="flex flex-col gap-3 @2xl/data-table:table-row-group">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                role="row"
                className="flex flex-col gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 @2xl/data-table:table-row @2xl/data-table:rounded-none @2xl/data-table:border-b @2xl/data-table:bg-transparent @2xl/data-table:p-0 @2xl/data-table:ring-0 @2xl/data-table:transition-colors @2xl/data-table:last:border-b-0 @2xl/data-table:hover:bg-muted/50"
              >
                {columns.map((column) => (
                  <DataTableCell key={column.id} column={column} row={row} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DataTableCell<T>({ column, row }: { column: DataTableColumn<T>; row: T }) {
  const showLabel = column.stackedLabel ?? !column.hideHeader;
  const content = column.cell(row);
  const empty = content === null || content === undefined || content === false;
  return (
    <td
      role="cell"
      title={column.title?.(row)}
      className={cn(
        "block min-w-0 @2xl/data-table:table-cell @2xl/data-table:px-4 @2xl/data-table:py-3 @2xl/data-table:align-middle",
        empty && "hidden",
        column.grow && column.wrap
          ? "wrap-anywhere @2xl/data-table:w-full"
          : column.grow
            ? "wrap-anywhere @2xl/data-table:w-full @2xl/data-table:max-w-0 @2xl/data-table:*:truncate"
            : "@2xl/data-table:whitespace-nowrap",
      )}
    >
      {showLabel ? (
        <span aria-hidden="true" className="mb-1 block text-xs font-medium text-muted-foreground @2xl/data-table:hidden">
          {column.header}
        </span>
      ) : null}
      {column.align === "end" ? <div className="flex @2xl/data-table:justify-end">{content}</div> : content}
    </td>
  );
}
