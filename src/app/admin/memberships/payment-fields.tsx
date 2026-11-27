import { InputField, SelectField, TextareaField } from "@/components/form-field";
import { NativeSelectOption } from "@/components/ui/native-select";
import { PAYMENT_METHOD_LABELS } from "@/lib/memberships-ui/labels";
import { FREE_TEXT_MAX_LENGTH, MANUAL_PAYMENT_METHODS, REFERENCE_MAX_LENGTH } from "@/lib/services/memberships/schemas";

/** Method, reference, and note of a front-desk payment (record payment and extend). */
export function PaymentFields({ idPrefix, errors }: { idPrefix: string; errors: Record<string, string> }) {
  return (
    <>
      <SelectField id={`${idPrefix}-method`} name="method" label="Payment method" defaultValue="" error={errors.method} required className="w-full">
        <NativeSelectOption value="" disabled>
          Choose a method
        </NativeSelectOption>
        {MANUAL_PAYMENT_METHODS.map((method) => (
          <NativeSelectOption key={method} value={method}>
            {PAYMENT_METHOD_LABELS[method]}
          </NativeSelectOption>
        ))}
      </SelectField>
      <InputField
        id={`${idPrefix}-reference`}
        name="reference"
        label="Reference"
        hint="Optional. The receipt or transaction number; each can be recorded once per method."
        error={errors.reference}
        maxLength={REFERENCE_MAX_LENGTH}
        autoComplete="off"
      />
      <TextareaField
        id={`${idPrefix}-note`}
        name="note"
        label="Note"
        hint="Optional, for staff only. No personal data: no email addresses or links."
        error={errors.note}
        maxLength={FREE_TEXT_MAX_LENGTH}
        rows={2}
      />
    </>
  );
}
