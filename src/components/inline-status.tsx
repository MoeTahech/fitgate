import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Short result line next to a row action (tables, lists). Use `FormAlert` for form-level messages. */
export function InlineStatus({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn("text-xs whitespace-normal", tone === "error" ? "text-destructive" : "text-success")}
    >
      {children}
    </p>
  );
}
