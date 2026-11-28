"use client";

import {
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
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

type Gate<F> = {
  /** Whether the dialog renders its own `fields`. */
  hasFields: boolean;
  validate?: (form: F) => boolean;
  form: F;
};

/**
 * Whether the trigger may open the dialog. Without `fields`, `validate` checks the form before
 * the dialog opens (it shows its own errors); with `fields`, it waits for the confirm.
 */
export function shouldOpen<F>({ hasFields, validate, form }: Gate<F>): boolean {
  return hasFields || !validate || validate(form);
}

/**
 * Runs on confirm: with `fields`, an invalid form isn't submitted and the dialog stays open. A
 * `submitter` (the confirm button, with `submitValue`) adds its name and value to the submit.
 */
export function confirmSubmit<F extends Pick<HTMLFormElement, "requestSubmit">>({
  hasFields,
  validate,
  form,
  submitter,
}: Gate<F> & { submitter?: HTMLElement }): "submitted" | "invalid" {
  if (hasFields && validate && !validate(form)) return "invalid";
  if (submitter) form.requestSubmit(submitter);
  else form.requestSubmit();
  return "submitted";
}

/**
 * Enter in a dialog input would submit the form implicitly, skipping `validate`; the dialog
 * handles it as the confirm button instead. Textareas keep Enter for new lines.
 */
export function isImplicitSubmit({ key, target, isComposing }: { key: string; target: unknown; isComposing: boolean }): boolean {
  return (
    key === "Enter" &&
    !isComposing &&
    typeof target === "object" &&
    target !== null &&
    "tagName" in target &&
    target.tagName === "INPUT"
  );
}

/**
 * A trigger button that asks for confirmation before submitting a form: its own hidden form
 * posting to `action` (e.g. a `useActionState` dispatcher), or an existing one given as `form`.
 * After confirming, focus moves to `finalFocus` when given (use an element that survives the
 * action, e.g. a results region, if the trigger may disappear); cancelling returns it to the trigger.
 *
 * `fields(formId)` renders inputs in the dialog body; give each control `form={formId}` so the
 * submit carries it although the dialog is a portal. `validate(form)` runs on confirm when
 * `fields` is set (a failure keeps the dialog open), otherwise before the dialog opens. Call
 * `showFieldErrors` in it so the first invalid field gets focus.
 *
 * `submitValue` makes the confirm button the form's submitter with that name and value, so only a
 * confirmed submit carries it (the form never holds it). `open`/`onOpenChange` control the dialog,
 * e.g. to open it from the form's own submit handler; the trigger still validates before opening.
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
  fields,
  validate,
  submitValue,
  open: openProp,
  onOpenChange: onOpenChangeProp,
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
  fields?: (formId: string) => ReactNode;
  validate?: (form: HTMLFormElement) => boolean;
  submitValue?: { name: string; value: string };
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} & Target) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const confirmed = useRef(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const ownFormId = useId();
  const formId = target.form ?? ownFormId;
  const hasFields = fields !== undefined;

  function targetForm(): HTMLFormElement {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) throw new Error(`ConfirmDialog: no form with id "${formId}"`);
    return form;
  }

  function setOpen(next: boolean) {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChangeProp?.(next);
  }

  function onOpenChange(next: boolean) {
    if (next) {
      if (!shouldOpen({ hasFields, validate, form: targetForm() })) return;
      confirmed.current = false;
    }
    setOpen(next);
  }

  function confirm() {
    const submitter = (submitValue && confirmButton.current) || undefined;
    if (confirmSubmit({ hasFields, validate, form: targetForm(), submitter }) === "invalid") return;
    confirmed.current = true;
    setOpen(false);
  }

  function onConfirmClick(event: MouseEvent<HTMLButtonElement>) {
    // With `submitValue` the button submits; its own activation would skip `validate`.
    event.preventDefault();
    confirm();
  }

  /** After a confirm, `finalFocus`; otherwise back to the trigger. Reset for the next opening. */
  function focusOnClose(): HTMLElement | true {
    const target = confirmed.current ? finalFocus?.current : null;
    confirmed.current = false;
    return target ?? true;
  }

  function onFieldsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isImplicitSubmit({ key: event.key, target: event.target, isComposing: event.nativeEvent.isComposing })) return;
    event.preventDefault();
    confirm();
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
        <AlertDialogContent finalFocus={focusOnClose}>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {fields ? (
            <div className="flex flex-col gap-4" onKeyDown={onFieldsKeyDown}>
              {fields(formId)}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
            <AlertDialogAction
              ref={confirmButton}
              variant={tone === "destructive" ? "destructive" : "default"}
              onClick={onConfirmClick}
              {...(submitValue
                ? { type: "submit", form: formId, name: submitValue.name, value: submitValue.value }
                : { type: "button" })}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
