import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const VARIANTS = { error: "destructive", warning: "warning", success: "success", info: "info" } as const;

/** Form-level message. Errors are announced assertively, everything else politely. */
export function FormAlert({ tone, children }: { tone: keyof typeof VARIANTS; children: ReactNode }) {
  return (
    <Alert variant={VARIANTS[tone]} role={tone === "error" ? "alert" : "status"}>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
