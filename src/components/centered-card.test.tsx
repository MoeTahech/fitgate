import { describe, expect, it } from "vitest";
import { byTag, find, renderMarkup, textOf } from "../../tests/support/markup";
import { CenteredCard } from "./centered-card";

describe("CenteredCard", () => {
  it("renders the title as a heading that is not focusable by default", () => {
    const heading = find(renderMarkup(<CenteredCard title="Reset your password">{null}</CenteredCard>), byTag("h1"));
    expect(heading && textOf(heading)).toBe("Reset your password");
    expect(heading?.attrs).not.toHaveProperty("tabindex");
  });

  it("makes the heading programmatically focusable with focusTitle", () => {
    const heading = find(
      renderMarkup(
        <CenteredCard title="Check your email" focusTitle>
          {null}
        </CenteredCard>,
      ),
      byTag("h1"),
    );
    expect(heading?.attrs.tabindex).toBe("-1");
  });
});
