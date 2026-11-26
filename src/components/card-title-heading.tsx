"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The `<h1>` of a `CenteredCard`. With `focus`, it is programmatically focusable and takes focus
 * when `focus` turns on, so a success view that replaces a form (and its focused submit button)
 * moves keyboard and screen reader users to its heading instead of dropping focus to the page.
 */
export function CardTitleHeading({ focus, children }: { focus: boolean; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);

  return (
    <h1
      ref={ref}
      tabIndex={focus ? -1 : undefined}
      className="text-xl font-semibold tracking-tight text-card-foreground outline-none"
    >
      {children}
    </h1>
  );
}
