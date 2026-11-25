import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Inline text link in the brand link color. Use `buttonVariants` on `Link` for links styled as buttons. */
export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn("font-medium text-link underline underline-offset-4 hover:text-link-hover", className)}
      {...props}
    />
  );
}
