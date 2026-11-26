import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { isEmptyNode, LiveRegions } from "./live-regions";

const VARIANTS = { error: "destructive", warning: "warning", success: "success", info: "info" } as const;

/**
 * Form-level message in always-mounted live regions: render it unconditionally and pass the
 * message (or nothing). Errors are announced assertively, everything else politely.
 */
export function FormAlert({ tone, children }: { tone: keyof typeof VARIANTS; children?: ReactNode }) {
  return (
    <LiveRegions assertive={tone === "error"}>
      {isEmptyNode(children) ? null : (
        <Alert variant={VARIANTS[tone]} role={undefined}>
          <AlertDescription>{children}</AlertDescription>
        </Alert>
      )}
    </LiveRegions>
  );
}
