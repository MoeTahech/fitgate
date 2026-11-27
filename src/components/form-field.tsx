import type { ComponentProps, ReactNode } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type FieldControlProps = {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
};

type FieldProps = { id: string; label: string; hint?: ReactNode; error?: string };

/** Label, control, hint and error with the ids and ARIA wiring between them. The hint hides while an error shows. */
export function FormField({ id, label, hint, error, children }: FieldProps & { children: (control: FieldControlProps) => ReactNode }) {
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint && !error ? `${id}-hint` : undefined;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": [errorId, hintId].filter(Boolean).join(" ") || undefined,
      })}
      {hintId ? <FieldDescription id={hintId}>{hint}</FieldDescription> : null}
      {errorId ? (
        <FieldError id={errorId} role={undefined}>
          {error}
        </FieldError>
      ) : null}
    </Field>
  );
}

export function InputField({ id, label, hint, error, ...input }: FieldProps & Omit<ComponentProps<typeof Input>, "id">) {
  return (
    <FormField id={id} label={label} hint={hint} error={error}>
      {(control) => <Input {...input} {...control} />}
    </FormField>
  );
}

export function TextareaField({ id, label, hint, error, ...textarea }: FieldProps & Omit<ComponentProps<typeof Textarea>, "id">) {
  return (
    <FormField id={id} label={label} hint={hint} error={error}>
      {(control) => <Textarea {...textarea} {...control} />}
    </FormField>
  );
}

/**
 * A native checkbox with its label beside it, so it submits with the form before any script runs:
 * checked, it sends `value` (default "on") under `name`. Colored with the brand `primary` token.
 */
export function CheckboxField({
  id,
  label,
  className,
  ...checkbox
}: { id: string; label: string } & Omit<ComponentProps<"input">, "id" | "type">) {
  return (
    <Field orientation="horizontal" className="w-auto items-center">
      <input
        {...checkbox}
        id={id}
        type="checkbox"
        data-slot="checkbox"
        className={cn(
          "size-4 shrink-0 cursor-pointer rounded-[4px] accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      />
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
    </Field>
  );
}

export function SelectField({ id, label, hint, error, ...select }: FieldProps & Omit<ComponentProps<typeof NativeSelect>, "id">) {
  return (
    <FormField id={id} label={label} hint={hint} error={error}>
      {(control) => <NativeSelect {...select} {...control} />}
    </FormField>
  );
}
