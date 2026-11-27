import { describe, expect, it } from "vitest";
import { byAttr, byTag, classesOf, elements, find, findAll, renderMarkup, textOf } from "../../tests/support/markup";
import { DataTable, type DataTableColumn } from "./data-table";

type Row = { id: string; email: string; status: string; action: boolean };

const ROWS: Row[] = [
  { id: "a", email: "first.long.address@example.com", status: "Pending", action: true },
  { id: "b", email: "second@example.com", status: "Revoked", action: false },
];

const COLUMNS: DataTableColumn<Row>[] = [
  {
    id: "email",
    header: "Email",
    grow: true,
    stackedLabel: false,
    cell: (row) => <p>{row.email}</p>,
  },
  { id: "status", header: "Status", cell: (row) => row.status },
  {
    id: "actions",
    header: "Actions",
    hideHeader: true,
    align: "end",
    cell: (row) => (row.action ? <button type="button">Act</button> : null),
  },
];

function render() {
  return renderMarkup(<DataTable label="Invites" rows={ROWS} rowKey={(row) => row.id} columns={COLUMNS} />);
}

function bodyRows() {
  return elements(find(render(), byTag("tbody"))!);
}

describe("DataTable", () => {
  it("keeps explicit table semantics and the accessible name", () => {
    const root = render();
    const table = find(root, byTag("table"));
    expect(table?.attrs.role).toBe("table");
    expect(table?.attrs["aria-label"]).toBe("Invites");
    expect(findAll(root, byAttr("role", "rowgroup")).map((group) => group.tag)).toEqual(["thead", "tbody"]);
    expect(bodyRows().map((row) => row.attrs.role)).toEqual(["row", "row"]);
    expect(findAll(root, byTag("th")).every((th) => th.attrs.role === "columnheader" && th.attrs.scope === "col")).toBe(true);
    for (const row of bodyRows()) {
      expect(elements(row).map((cell) => cell.attrs.role)).toEqual(["cell", "cell", "cell"]);
    }
  });

  it("renders one row per item in order", () => {
    expect(bodyRows().map((row) => textOf(elements(row)[0]))).toEqual(ROWS.map((row) => row.email));
  });

  it("renders headers, keeping hidden ones for screen readers", () => {
    const headers = findAll(render(), byTag("th"));
    expect(headers.map(textOf)).toEqual(["Email", "Status", "Actions"]);
    expect(classesOf(find(headers[2], byTag("span")))).toContain("sr-only");
    expect(classesOf(find(render(), byTag("thead")))).toEqual(expect.arrayContaining(["sr-only", "@2xl/data-table:not-sr-only"]));
  });

  it("labels values in card mode with aria-hidden copies of the header", () => {
    const [email, status, actions] = elements(bodyRows()[0]);
    expect(find(email, byAttr("aria-hidden"))).toBeUndefined();
    const label = find(status, byAttr("aria-hidden", "true"));
    expect(label && textOf(label)).toBe("Status");
    expect(classesOf(label)).toContain("@2xl/data-table:hidden");
    expect(find(actions, byAttr("aria-hidden"))).toBeUndefined();
  });

  it("lets the grow column take the remaining width and wrap in both modes, never truncating it", () => {
    const email = elements(bodyRows()[0])[0];
    const classes = classesOf(email);
    expect(classes).toEqual(expect.arrayContaining(["wrap-anywhere", "@2xl/data-table:w-full"]));
    expect(classes.some((name) => name.includes("truncate"))).toBe(false);
    expect(classes).not.toContain("@2xl/data-table:max-w-0");
    expect(classes).not.toContain("@2xl/data-table:whitespace-nowrap");
    expect(email.attrs.title).toBeUndefined();
  });

  it("keeps other columns on one line in table mode only", () => {
    const status = classesOf(elements(bodyRows()[0])[1]);
    expect(status).toContain("@2xl/data-table:whitespace-nowrap");
    expect(status).not.toContain("whitespace-nowrap");
    expect(elements(bodyRows()[0])[1].attrs.title).toBeUndefined();
  });

  it("right-aligns end columns in table mode only", () => {
    const wrapper = elements(elements(bodyRows()[0])[2])[0];
    expect(classesOf(wrapper)).toEqual(["flex", "@2xl/data-table:justify-end"]);
  });

  it("hides empty cells in card mode but keeps them as table cells", () => {
    const actions = classesOf(elements(bodyRows()[1])[2]);
    expect(actions).toEqual(expect.arrayContaining(["hidden", "@2xl/data-table:table-cell"]));
    expect(classesOf(elements(bodyRows()[0])[2])).not.toContain("hidden");
  });
});
