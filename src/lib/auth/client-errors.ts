type ClientError = { status?: number; code?: string } | null | undefined;

export const RATE_LIMITED_MESSAGE = "Too many attempts. Please wait a few minutes and try again.";
export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export function isRateLimited(error: ClientError): boolean {
  return error?.status === 429;
}

export function describeAuthError(error: ClientError, fallback = GENERIC_ERROR_MESSAGE): string {
  if (isRateLimited(error)) return RATE_LIMITED_MESSAGE;
  return fallback;
}
