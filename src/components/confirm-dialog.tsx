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

type Target =
  /** Submits an own hidden form to `action`; `children` go inside it (hidden inputs). */
  | { action: (formData: FormData) => void; children?: ReactNode; form?: never }
  /** Submits an existing form (by id), e.g. one whose fields the user just edited. */
  | { form: string; action?: never; children?: never };

/**
 * A trigger button that asks for confirmation before submitting a form: its own hidden form
 * posting to `action` (e.g. a `useActionState` dispatcher), or an existing one given as `form`.
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
  pending = false,
  finalFocus,
  ...target
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
  pending?: boolean;
  finalFocus?: RefObject<HTMLElement | null>;
} & Target) {
  const [open, setOpen] = useState(false);
  const confirmed = useRef(false);
  const ownFormId = useId();
  const formId = target.form ?? ownFormId;

  function onOpenChange(next: boolean) {
    if (next) confirmed.current = false;
    setOpen(next);
  }

  function confirm() {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) throw new Error(`ConfirmDialog: no form with id "${formId}"`);
    confirmed.current = true;
    form.requestSubmit();
    setOpen(false);
  }

  return (
    <>
      {target.form === undefined ? (
        <form id={ownFormId} action={target.action} hidden>
          {target.children}
        </form>
      ) : null}
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
            <AlertDialogAction type="button" variant={tone === "destructive" ? "destructive" : "default"} onClick={confirm}>
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
