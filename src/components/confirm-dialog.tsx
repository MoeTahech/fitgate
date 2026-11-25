"use client";

import { useId, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type ButtonProps = ComponentProps<typeof Button>;

/**
 * A trigger button that asks for confirmation before submitting `action` (e.g. a
 * `useActionState` dispatcher). `children` go inside the submitted form (hidden inputs).
 * After confirming, focus moves to `finalFocus` when given (use an element that survives the
 * action, e.g. a results region, if the trigger may disappear); cancelling returns it to the trigger.
 */
export function ConfirmDialog({
  triggerLabel,
  pendingLabel,
  triggerVariant = "outline",
  triggerSize = "default",
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  action,
  pending = false,
  finalFocus,
  children,
}: {
  triggerLabel: string;
  pendingLabel?: string;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "destructive";
  action: (formData: FormData) => void;
  pending?: boolean;
  finalFocus?: RefObject<HTMLElement | null>;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const confirmed = useRef(false);
  const formId = useId();

  function onOpenChange(next: boolean) {
    if (next) confirmed.current = false;
    setOpen(next);
  }

  return (
    <>
      <form id={formId} action={action} onSubmit={() => setOpen(false)} hidden>
        {children}
      </form>
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogTrigger
          render={<Button variant={triggerVariant} size={triggerSize} disabled={pending} aria-busy={pending || undefined} />}
        >
          {pending && pendingLabel ? pendingLabel : triggerLabel}
        </AlertDialogTrigger>
        <AlertDialogContent finalFocus={() => (confirmed.current && finalFocus?.current) || true}>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
            <AlertDialogAction
              type="submit"
              form={formId}
              variant={tone === "destructive" ? "destructive" : "default"}
              onClick={() => {
                confirmed.current = true;
              }}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
