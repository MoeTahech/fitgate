import { flushSync } from "react-dom";

type NamedControl = { name: string };

/** The first control, in document order, whose `name` has an error. */
export function firstInvalidControl<T extends NamedControl>(controls: Iterable<T>, errors: Record<string, string>): T | null {
  for (const control of controls) {
    if (control.name && Object.hasOwn(errors, control.name)) return control;
  }
  return null;
}

/**
 * Shows client-side validation errors and moves focus to the first invalid field. The update is
 * flushed first, so the focused field already carries `aria-invalid` and its error through
 * `aria-describedby`, and screen readers read the error with the label. Call it synchronously
 * from the submit handler.
 */
export function showFieldErrors(
  form: HTMLFormElement,
  errors: Record<string, string>,
  setErrors: (errors: Record<string, string>) => void,
): void {
  flushSync(() => setErrors(errors));
  const controls = Array.from(form.elements).filter(
    (element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
      "name" in element && typeof element.name === "string" && "focus" in element,
  );
  firstInvalidControl(controls, errors)?.focus();
}
