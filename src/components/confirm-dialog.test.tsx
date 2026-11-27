import { describe, expect, it, vi } from "vitest";
import { byAttr, byTag, find, renderMarkup, textOf } from "../../tests/support/markup";
import { ConfirmDialog, confirmSubmit, isImplicitSubmit, shouldOpen } from "./confirm-dialog";

function stubForm() {
  return { requestSubmit: vi.fn() };
}

function render(props: { pending?: boolean } = {}) {
  return renderMarkup(
    <ConfirmDialog
      triggerLabel="Revoke"
      pendingLabel="Revoking…"
      title="Revoke this invite?"
      description="The link will stop working."
      confirmLabel="Revoke invite"
      action={() => {}}
      {...props}
    >
      <input type="hidden" name="inviteId" value="invite-1" />
    </ConfirmDialog>,
  );
}

describe("ConfirmDialog", () => {
  it("renders a hidden form holding the submitted inputs", () => {
    const form = find(render(), byTag("form"));
    expect(form && "hidden" in form.attrs).toBe(true);
    expect(form && find(form, byAttr("name", "inviteId"))?.attrs.value).toBe("invite-1");
  });

  it("renders an enabled trigger with its label", () => {
    const trigger = find(render(), byTag("button"));
    expect(trigger && textOf(trigger)).toBe("Revoke");
    expect(trigger?.attrs).not.toHaveProperty("disabled");
    expect(trigger?.attrs).not.toHaveProperty("aria-busy");
  });

  it("renders no form of its own when it submits an existing form", () => {
    const markup = renderMarkup(
      <ConfirmDialog
        triggerLabel="Save"
        title="Remove your own admin access?"
        description="You'll be signed out."
        confirmLabel="Change my role"
        form="role-form"
      />,
    );
    expect(find(markup, byTag("form"))).toBeUndefined();
    const trigger = find(markup, byTag("button"));
    expect(trigger && textOf(trigger)).toBe("Save");
    expect(trigger?.attrs.type).toBe("button");
  });

  it("disables the trigger and marks it busy while pending", () => {
    const trigger = find(render({ pending: true }), byTag("button"));
    expect(trigger && textOf(trigger)).toBe("Revoking…");
    expect(trigger?.attrs).toHaveProperty("disabled");
    expect(trigger?.attrs["aria-busy"]).toBe("true");
  });
});

describe("ConfirmDialog with fields", () => {
  it("renders the hidden form but no fields while closed", () => {
    const markup = renderMarkup(
      <ConfirmDialog
        triggerLabel="Void"
        title="Void this payment?"
        description="The membership is cancelled."
        confirmLabel="Void payment"
        action={() => {}}
        fields={(formId) => <input name="reason" form={formId} />}
        validate={() => true}
      >
        <input type="hidden" name="paymentId" value="payment-1" />
      </ConfirmDialog>,
    );
    expect(find(markup, byAttr("name", "paymentId"))).toBeDefined();
    expect(find(markup, byAttr("name", "reason"))).toBeUndefined();
  });
});

describe("shouldOpen", () => {
  it("opens when there is nothing to validate", () => {
    expect(shouldOpen({ hasFields: false, form: stubForm() })).toBe(true);
    expect(shouldOpen({ hasFields: true, form: stubForm() })).toBe(true);
  });

  it("validates the form before opening when the dialog has no fields", () => {
    const form = stubForm();
    const validate = vi.fn(() => true);
    expect(shouldOpen({ hasFields: false, validate, form })).toBe(true);
    expect(validate).toHaveBeenCalledWith(form);
  });

  it("stays closed when the form is invalid and the dialog has no fields", () => {
    expect(shouldOpen({ hasFields: false, validate: () => false, form: stubForm() })).toBe(false);
  });

  it("opens without validating when the dialog has fields", () => {
    const validate = vi.fn(() => false);
    expect(shouldOpen({ hasFields: true, validate, form: stubForm() })).toBe(true);
    expect(validate).not.toHaveBeenCalled();
  });
});

describe("confirmSubmit", () => {
  it("keeps the dialog open and never submits when its fields are invalid", () => {
    const form = stubForm();
    const validate = vi.fn(() => false);
    expect(confirmSubmit({ hasFields: true, validate, form })).toBe("invalid");
    expect(validate).toHaveBeenCalledWith(form);
    expect(form.requestSubmit).not.toHaveBeenCalled();
  });

  it("submits once when its fields are valid", () => {
    const form = stubForm();
    const validate = vi.fn(() => true);
    expect(confirmSubmit({ hasFields: true, validate, form })).toBe("submitted");
    expect(validate).toHaveBeenCalledOnce();
    expect(form.requestSubmit).toHaveBeenCalledOnce();
  });

  it("submits without validating again when the dialog has no fields", () => {
    const form = stubForm();
    const validate = vi.fn(() => false);
    expect(confirmSubmit({ hasFields: false, validate, form })).toBe("submitted");
    expect(validate).not.toHaveBeenCalled();
    expect(form.requestSubmit).toHaveBeenCalledOnce();
  });

  it("submits when there is nothing to validate", () => {
    const form = stubForm();
    expect(confirmSubmit({ hasFields: true, form })).toBe("submitted");
    expect(form.requestSubmit).toHaveBeenCalledOnce();
  });

  it("submits with the confirm button as the submitter, so its name and value are sent", () => {
    const form = stubForm();
    const submitter = { name: "confirmSwitch", value: "true" } as unknown as HTMLElement;
    expect(confirmSubmit({ hasFields: false, form, submitter })).toBe("submitted");
    expect(form.requestSubmit).toHaveBeenCalledExactlyOnceWith(submitter);
  });

  it("submits without a submitter by default", () => {
    const form = stubForm();
    confirmSubmit({ hasFields: false, form });
    expect(form.requestSubmit).toHaveBeenCalledExactlyOnceWith();
  });

  it("never submits with the submitter when its fields are invalid", () => {
    const form = stubForm();
    const submitter = { name: "confirmSwitch", value: "true" } as unknown as HTMLElement;
    expect(confirmSubmit({ hasFields: true, validate: () => false, form, submitter })).toBe("invalid");
    expect(form.requestSubmit).not.toHaveBeenCalled();
  });
});

describe("isImplicitSubmit", () => {
  const input = { tagName: "INPUT" };

  it("treats Enter in an input as the confirm", () => {
    expect(isImplicitSubmit({ key: "Enter", target: input, isComposing: false })).toBe(true);
  });

  it("ignores Enter while an IME composition is open", () => {
    expect(isImplicitSubmit({ key: "Enter", target: input, isComposing: true })).toBe(false);
  });

  it("ignores other keys", () => {
    expect(isImplicitSubmit({ key: "a", target: input, isComposing: false })).toBe(false);
    expect(isImplicitSubmit({ key: "Escape", target: input, isComposing: false })).toBe(false);
  });

  it.each(["TEXTAREA", "SELECT", "BUTTON"])("leaves Enter alone in a %s", (tagName) => {
    expect(isImplicitSubmit({ key: "Enter", target: { tagName }, isComposing: false })).toBe(false);
  });

  it("ignores targets that aren't elements", () => {
    expect(isImplicitSubmit({ key: "Enter", target: null, isComposing: false })).toBe(false);
    expect(isImplicitSubmit({ key: "Enter", target: "INPUT", isComposing: false })).toBe(false);
  });
});
