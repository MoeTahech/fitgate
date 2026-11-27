import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { RowAction } from "@/components/action-results";
import { firstInvalidControl, showFieldErrors } from "@/lib/forms/field-errors";
import { parseForm, type ActionResult } from "./forms";

const IDLE: ActionResult = { status: "idle" };

function namedControls(form: HTMLFormElement) {
  return Array.from(form.elements).filter(
    (element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
      "name" in element && typeof element.name === "string" && "focus" in element,
  );
}

/**
 * A form with fields and its own result (record payment, extend). It keeps what was typed when
 * the action fails: `submit` dispatches the action itself instead of `<form action>`, whose
 * automatic reset would clear the fields, and the form resets only after a success. `validate`
 * runs the shared schema and focuses the first invalid field; server field errors focus theirs.
 */
export function useMembershipForm<S extends z.ZodType>(action: RowAction, schema: S) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, dispatch, pending] = useActionState(action, IDLE);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    if (state.status === "success") form.reset();
    else if (state.fieldErrors) firstInvalidControl(namedControls(form), state.fieldErrors)?.focus();
  }, [state]);

  function validate(form: HTMLFormElement): boolean {
    const parsed = parseForm(schema, new FormData(form));
    if (parsed.success) {
      setClientErrors({});
      return true;
    }
    showFieldErrors(form, parsed.fieldErrors, setClientErrors);
    return false;
  }

  /** Sends the form; a `submitter` (e.g. a confirm button) adds its name and value. */
  function submit(form: HTMLFormElement, submitter?: HTMLElement | null) {
    const formData = submitter ? new FormData(form, submitter) : new FormData(form);
    startTransition(() => dispatch(formData));
  }

  const errors = Object.keys(clientErrors).length > 0 ? clientErrors : state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return { formRef, state, pending, errors, validate, submit };
}
