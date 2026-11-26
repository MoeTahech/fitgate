import { describe, expect, it } from "vitest";
import { byAttr, byTag, find, renderMarkup, textOf } from "../../tests/support/markup";
import { ConfirmDialog } from "./confirm-dialog";

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
