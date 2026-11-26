import { describe, expect, it } from "vitest";
import { byAttr, classesOf, find, renderMarkup, textOf } from "../../tests/support/markup";
import {
  ACTION_FAILED_MESSAGE,
  ActionResults,
  ActionResultsProvider,
  describeActionResult,
  useActionResults,
  type ActionOutcome,
  type PendingAction,
} from "./action-results";

const PENDING: PendingAction = { key: "revoke:invite-1", message: "Revoking the invite…" };

describe("describeActionResult", () => {
  it("shows nothing before any action ran", () => {
    expect(describeActionResult({ status: "idle" }, null)).toBeNull();
  });

  it("shows the pending message while an action runs", () => {
    expect(describeActionResult({ status: "idle" }, PENDING)).toEqual({ tone: "info", text: "Revoking the invite…" });
  });

  it("prefers the running action over the previous result", () => {
    const previous: ActionOutcome = { status: "error", message: "This invite is no longer pending." };
    expect(describeActionResult(previous, PENDING)).toEqual({ tone: "info", text: "Revoking the invite…" });
  });

  it("shows the success message", () => {
    expect(describeActionResult({ status: "success", message: "Invite revoked." }, null)).toEqual({
      tone: "success",
      text: "Invite revoked.",
    });
  });

  it("shows nothing for a success without a message", () => {
    expect(describeActionResult({ status: "success" }, null)).toBeNull();
  });

  it("shows the error message", () => {
    expect(describeActionResult({ status: "error", message: "This freeze has already started." }, null)).toEqual({
      tone: "error",
      text: "This freeze has already started.",
    });
  });

  it("prefers the error message over field errors", () => {
    const result: ActionOutcome = { status: "error", message: "Check the amount.", fieldErrors: { amount: "Too high." } };
    expect(describeActionResult(result, null)?.text).toBe("Check the amount.");
  });

  it("falls back to the first field error", () => {
    const result: ActionOutcome = { status: "error", fieldErrors: { amount: "Enter less than €40.00.", reason: "Enter a reason." } };
    expect(describeActionResult(result, null)).toEqual({ tone: "error", text: "Enter less than €40.00." });
  });

  it("falls back to a generic retry message", () => {
    expect(describeActionResult({ status: "error" }, null)).toEqual({ tone: "error", text: ACTION_FAILED_MESSAGE });
    expect(describeActionResult({ status: "error", fieldErrors: {} }, null)).toEqual({ tone: "error", text: ACTION_FAILED_MESSAGE });
  });
});

describe("ActionResults", () => {
  it("renders an empty, focusable results region with both live regions mounted", () => {
    const root = renderMarkup(
      <ActionResultsProvider>
        <ActionResults />
      </ActionResultsProvider>,
    );
    const region = find(root, byAttr("tabindex", "-1"));
    expect(region).toBeDefined();
    expect(classesOf(region)).toContain("outline-none");
    expect(classesOf(region)).not.toContain("mb-3");
    const alert = find(region!, byAttr("role", "alert"));
    const status = find(region!, byAttr("role", "status"));
    expect(alert && textOf(alert)).toBe("");
    expect(status && textOf(status)).toBe("");
  });

  it("gives row actions no pending key before anything runs", () => {
    function PendingKey() {
      const { pendingKey } = useActionResults();
      return <output>{pendingKey ?? "none"}</output>;
    }
    const root = renderMarkup(
      <ActionResultsProvider>
        <PendingKey />
      </ActionResultsProvider>,
    );
    expect(textOf(root)).toBe("none");
  });

  it("requires the provider", () => {
    expect(() => renderMarkup(<ActionResults />)).toThrow("useActionResults must be used inside <ActionResultsProvider>");
  });
});
