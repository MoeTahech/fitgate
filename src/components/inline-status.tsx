import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LiveRegions } from "./live-regions";

/**
 * Short result line next to a row action, in always-mounted live regions: render it
 * unconditionally and pass the message (or nothing). Use `FormAlert` for form-level messages.
 */
export function InlineStatus({ tone, children }: { tone: "error" | "success"; children?: ReactNode }) {
  return (
    <LiveRegions
      assertive={tone === "error"}
      className={cn("text-xs whitespace-normal", tone === "error" ? "text-destructive" : "text-success")}
    >
      {children}
    </LiveRegions>
  );
}
