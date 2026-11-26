import { describe, expect, it } from "vitest";
import { byTag, classesOf, elements, find, findAll, renderMarkup, textOf } from "../../tests/support/markup";
import { DetailList } from "./detail-list";

const ITEMS = [
  { term: "Period", value: "12 Nov 2026 – 12 Dec 2026" },
  { term: "Shared by", value: <a href="/members/1">Alex Example</a> },
  { term: "Reference", value: "a-very-long-reference-without-any-break-opportunities-0123456789" },
];

describe("DetailList", () => {
  it("renders one term and one value per item, in order, inside a dl", () => {
    const root = renderMarkup(<DetailList items={ITEMS} />);
    const list = find(root, byTag("dl"));
    expect(list).toBeDefined();
    expect(elements(list!).map((child) => child.tag)).toEqual(["dt", "dd", "dt", "dd", "dt", "dd"]);
    expect(findAll(root, byTag("dt")).map(textOf)).toEqual(["Period", "Shared by", "Reference"]);
    expect(findAll(root, byTag("dd")).map(textOf)).toEqual([
      "12 Nov 2026 – 12 Dec 2026",
      "Alex Example",
      "a-very-long-reference-without-any-break-opportunities-0123456789",
    ]);
  });

  it("renders element values as they are", () => {
    const root = renderMarkup(<DetailList items={ITEMS} />);
    expect(find(root, byTag("a"))?.attrs.href).toBe("/members/1");
  });

  it("stacks on phones, pairs up from sm, and lets long values wrap", () => {
    const root = renderMarkup(<DetailList items={ITEMS} />);
    expect(classesOf(find(root, byTag("dl")))).toContain("sm:grid-cols-[9rem_1fr]");
    for (const dd of findAll(root, byTag("dd"))) expect(classesOf(dd)).toContain("wrap-anywhere");
  });

  it("renders an empty list without rows", () => {
    const root = renderMarkup(<DetailList items={[]} />);
    expect(findAll(root, byTag("dt"))).toEqual([]);
  });
});
