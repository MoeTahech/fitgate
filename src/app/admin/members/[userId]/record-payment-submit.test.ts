import { describe, expect, it } from "vitest";
import { CONFIRM_SWITCH, isSwitchConfirmation, recordPaymentStep } from "./record-payment-submit";

const SWITCH = { blocked: false, needsConfirm: true };
const SUPERSEDE = { blocked: false, needsConfirm: false };
const BLOCKED = { blocked: true, needsConfirm: false };

describe("recordPaymentStep", () => {
  it("sends a plan that needs no notice", () => {
    expect(recordPaymentStep({ notice: null, confirmed: false })).toBe("submit");
  });

  it("sends a supersede without confirmation", () => {
    expect(recordPaymentStep({ notice: SUPERSEDE, confirmed: false })).toBe("submit");
  });

  it("opens the switch dialog instead of sending an unconfirmed switch", () => {
    expect(recordPaymentStep({ notice: SWITCH, confirmed: false })).toBe("confirm");
  });

  it("sends a switch confirmed in the dialog", () => {
    expect(recordPaymentStep({ notice: SWITCH, confirmed: true })).toBe("submit");
  });

  it("never sends a blocked plan, confirmed or not", () => {
    expect(recordPaymentStep({ notice: BLOCKED, confirmed: false })).toBe("blocked");
    expect(recordPaymentStep({ notice: BLOCKED, confirmed: true })).toBe("blocked");
  });
});

describe("isSwitchConfirmation", () => {
  it("recognizes the dialog's confirm button", () => {
    expect(isSwitchConfirmation({ ...CONFIRM_SWITCH })).toBe(true);
  });

  it.each([null, undefined, { name: "", value: "" }, { name: "confirmSwitch", value: "false" }, { name: "save", value: "true" }])(
    "rejects %j",
    (submitter) => {
      expect(isSwitchConfirmation(submitter)).toBe(false);
    },
  );
});
