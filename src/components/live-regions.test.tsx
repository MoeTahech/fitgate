import { describe, expect, it } from "vitest";
import { byAttr, classesOf, elements, find, renderMarkup, textOf } from "../../tests/support/markup";
import { FormAlert } from "./form-alert";
import { InlineStatus } from "./inline-status";

function regions(markup: ReturnType<typeof renderMarkup>) {
  const [alert, status] = elements(markup);
  return { alert, status };
}

describe("FormAlert", () => {
  it.each([null, undefined, "", false])("keeps both regions mounted and empty for %s", (message) => {
    const { alert, status } = regions(renderMarkup(<FormAlert tone="error">{message}</FormAlert>));
    expect(alert.attrs.role).toBe("alert");
    expect(status.attrs.role).toBe("status");
    expect(alert.children).toEqual([]);
    expect(status.children).toEqual([]);
    expect(classesOf(alert)).toContain("empty:absolute");
    expect(classesOf(status)).toContain("empty:absolute");
  });

  it("puts errors into the alert region", () => {
    const { alert, status } = regions(renderMarkup(<FormAlert tone="error">Incorrect email or password.</FormAlert>));
    expect(textOf(alert)).toBe("Incorrect email or password.");
    expect(status.children).toEqual([]);
  });

  it.each(["success", "info", "warning"] as const)("puts %s messages into the status region", (tone) => {
    const { alert, status } = regions(renderMarkup(<FormAlert tone={tone}>Saved.</FormAlert>));
    expect(alert.children).toEqual([]);
    expect(textOf(status)).toBe("Saved.");
  });

  it("drops the inner alert role so only the region announces", () => {
    const markup = renderMarkup(<FormAlert tone="error">Nope.</FormAlert>);
    const inner = find(markup, byAttr("data-slot", "alert"));
    expect(inner).toBeDefined();
    expect(inner?.attrs).not.toHaveProperty("role");
  });
});

describe("InlineStatus", () => {
  it("keeps both regions mounted and empty without a message", () => {
    const { alert, status } = regions(renderMarkup(<InlineStatus tone="success">{undefined}</InlineStatus>));
    expect([alert.attrs.role, status.attrs.role]).toEqual(["alert", "status"]);
    expect(alert.children).toEqual([]);
    expect(status.children).toEqual([]);
  });

  it("puts errors into the alert region and successes into the status region", () => {
    const error = regions(renderMarkup(<InlineStatus tone="error">Failed.</InlineStatus>));
    expect(textOf(error.alert)).toBe("Failed.");
    expect(error.status.children).toEqual([]);
    const success = regions(renderMarkup(<InlineStatus tone="success">Role updated.</InlineStatus>));
    expect(success.alert.children).toEqual([]);
    expect(textOf(success.status)).toBe("Role updated.");
  });
});
