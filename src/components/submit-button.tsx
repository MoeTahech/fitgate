import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

export function SubmitButton({ pending, disabled, ...props }: Omit<ComponentProps<typeof Button>, "type"> & { pending: boolean }) {
  return <Button {...props} type="submit" disabled={pending || disabled} aria-busy={pending || undefined} />;
}
