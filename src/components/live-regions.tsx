import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function isEmptyNode(node: ReactNode): boolean {
  return node === null || node === undefined || node === false || node === true || node === "";
}

/**
 * An `alert` and a `status` region that are always in the DOM, so screen readers announce
 * messages inserted later (a region mounted together with its text is often missed). `children`
 * goes into the alert region when `assertive`, else into the status region. Empty regions are
 * taken out of flow (`empty:absolute`, still in the accessibility tree) so they add no gap.
 */
export function LiveRegions({
  assertive,
  className,
  children,
}: {
  assertive: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const content = isEmptyNode(children) ? null : children;
  return (
    <>
      <div role="alert" className={cn("empty:absolute", className)}>
        {assertive ? content : null}
      </div>
      <div role="status" className={cn("empty:absolute", className)}>
        {assertive ? null : content}
      </div>
    </>
  );
}
