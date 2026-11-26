import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The `<main>` of a standard page: centered column with page padding. */
export function PageContainer({ width = "default", children }: { width?: "default" | "narrow"; children: ReactNode }) {
  return (
    <main className={cn("mx-auto w-full flex-1 px-4 py-8 sm:py-10", width === "narrow" ? "max-w-2xl" : "max-w-5xl")}>
      {children}
    </main>
  );
}
