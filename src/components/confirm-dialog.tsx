"use client";

import { useId, useState, type ComponentProps, type ReactNode } from "react";
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
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const formId = useId();
  return (
    <>
      <form id={formId} action={action} onSubmit={() => setOpen(false)} hidden>
        {children}
      </form>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger
          render={<Button variant={triggerVariant} size={triggerSize} disabled={pending} aria-busy={pending || undefined} />}
        >
          {pending && pendingLabel ? pendingLabel : triggerLabel}
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
            <AlertDialogAction type="submit" form={formId} variant={tone === "destructive" ? "destructive" : "default"}>
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
