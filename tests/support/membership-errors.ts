import { expect } from "vitest";
import { MembershipError, type MembershipErrorCode } from "@/lib/services/memberships/errors";

/** Awaits the promise, expects it to reject with a MembershipError of the code, and returns the error. */
export async function expectMembershipError(promise: Promise<unknown>, code: MembershipErrorCode): Promise<MembershipError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(MembershipError);
  expect((error as MembershipError).code).toBe(code);
  return error as MembershipError;
}
