import { describe, expect, it } from "vitest";
import { byAttr, byTag, classesOf, find, findAll, renderMarkup, textOf } from "../../tests/support/markup";
import { CheckboxField, TextareaField } from "./form-field";

describe("CheckboxField", () => {
  it("renders a native checkbox labelled by its label element, submitting its value under its name", () => {
    const root = renderMarkup(<CheckboxField id="expiring" name="expiring" value="true" label="Ending soon" defaultChecked />);
    const label = find(root, byTag("label"));
    const inputs = findAll(root, byTag("input"));
    expect(inputs).toHaveLength(1);
    const [checkbox] = inputs;
    expect(checkbox.attrs).toMatchObject({ id: "expiring", type: "checkbox", name: "expiring", value: "true" });
    expect(checkbox.attrs).toHaveProperty("checked");
    expect(textOf(label!)).toBe("Ending soon");
    expect(label?.attrs.for).toBe("expiring");
    expect(checkbox.attrs).not.toHaveProperty("aria-labelledby");
    expect(checkbox.attrs).not.toHaveProperty("role");
    expect(find(root, byAttr("role", "checkbox"))).toBeUndefined();
  });

  it("starts unchecked by default and uses the brand token for its color", () => {
    const checkbox = find(renderMarkup(<CheckboxField id="expiring" name="expiring" label="Ending soon" />), byTag("input"));
    expect(checkbox?.attrs).not.toHaveProperty("checked");
    expect(classesOf(checkbox)).toEqual(expect.arrayContaining(["accent-primary", "focus-visible:ring-ring"]));
  });
});

describe("TextareaField", () => {
  it("labels the textarea and passes its props through", () => {
    const root = renderMarkup(<TextareaField id="note" name="note" label="Note" rows={4} maxLength={500} defaultValue="Paid in cash" />);
    const label = find(root, byTag("label"));
    const textarea = find(root, byTag("textarea"));
    expect(textOf(label!)).toBe("Note");
    expect(label?.attrs.for).toBe("note");
    expect(textarea?.attrs.id).toBe("note");
    expect(textarea?.attrs.name).toBe("note");
    expect(textarea?.attrs.rows).toBe("4");
    expect(textarea?.attrs.maxLength).toBe("500");
    expect(textOf(textarea!)).toBe("Paid in cash");
    expect(textarea?.attrs["aria-invalid"]).toBeUndefined();
    expect(textarea?.attrs["aria-describedby"]).toBeUndefined();
  });

  it("describes the textarea by its hint", () => {
    const root = renderMarkup(<TextareaField id="note" name="note" label="Note" hint="No personal data" />);
    const textarea = find(root, byTag("textarea"));
    expect(textarea?.attrs["aria-describedby"]).toBe("note-hint");
    expect(textOf(find(root, (el) => el.attrs.id === "note-hint")!)).toBe("No personal data");
  });

  it("marks the textarea invalid and shows the error instead of the hint", () => {
    const root = renderMarkup(<TextareaField id="note" name="note" label="Note" hint="No personal data" error="Remove the email address" />);
    const textarea = find(root, byTag("textarea"));
    expect(textarea?.attrs["aria-invalid"]).toBe("true");
    expect(textarea?.attrs["aria-describedby"]).toBe("note-error");
    expect(textOf(find(root, (el) => el.attrs.id === "note-error")!)).toBe("Remove the email address");
    expect(find(root, (el) => el.attrs.id === "note-hint")).toBeUndefined();
  });

  it("uses the shared textarea styling", () => {
    const textarea = find(renderMarkup(<TextareaField id="note" label="Note" />), byTag("textarea"));
    expect(textarea?.attrs["data-slot"]).toBe("textarea");
    expect(classesOf(textarea)).toContain("w-full");
  });
});
