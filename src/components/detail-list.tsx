import type { ReactNode } from "react";

export type DetailItem = { term: string; value: ReactNode };

/** Term and value pairs: side by side from `sm`, stacked below. Long values wrap instead of scrolling. */
export function DetailList({ items }: { items: readonly DetailItem[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[9rem_1fr] sm:gap-y-4">
      {items.map(({ term, value }) => (
        <DetailRow key={term} term={term} value={value} />
      ))}
    </dl>
  );
}

function DetailRow({ term, value }: DetailItem) {
  return (
    <>
      <dt className="mt-3 text-muted-foreground first:mt-0 sm:mt-0">{term}</dt>
      <dd className="font-medium wrap-anywhere">{value}</dd>
    </>
  );
}
