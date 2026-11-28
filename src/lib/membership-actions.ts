import "server-only";
import { refresh } from "next/cache";
import type { z } from "zod";
import { isAuthError, requireRole, requireUser, type SessionUser } from "@/lib/auth/session";
import { getRequestIpHash } from "@/lib/request-ip";
import { MembershipError, toMembershipError } from "@/lib/services/memberships/errors";
import { parseForm, type ActionResult } from "@/lib/memberships-ui/forms";
import {
  authErrorResult,
  membershipErrorResult,
  type MembershipErrorLike,
  type MessageAudience,
} from "@/lib/memberships-ui/messages";

export type ActionContext = { user: SessionUser; ipHash: string | null };

/**
 * An invalid hidden field (an id) means the page is stale: its error becomes the message. Errors
 * on the visible fields stay field errors.
 */
function invalidForm(fieldErrors: Record<string, string>, visibleFields: readonly string[]): ActionResult {
  const hidden = Object.entries(fieldErrors).find(([field]) => !visibleFields.includes(field));
  return hidden ? { status: "error", message: hidden[1] } : { status: "error", fieldErrors };
}

type RunOptions<S extends z.ZodType> = {
  /** `member` needs a signed-in user, `admin` the ADMIN role; also picks the error copy. */
  audience: MessageAudience;
  formData: FormData;
  /**
   * The form schema, or a function that builds it after the actor is checked (e.g. from data looked
   * up on the server); a `MembershipError` it throws becomes the result like a service error.
   */
  schema: S | ((formData: FormData) => Promise<S>);
  /** Fields the form shows; errors on any other field are reported as the message. */
  visibleFields: readonly string[];
  perform: (data: z.output<S>, context: ActionContext) => Promise<ActionResult>;
  /** Errors that mean the page is stale; the route is refreshed so the form shows the current options. */
  refreshOnError?: (error: MembershipErrorLike) => boolean;
};

/**
 * The body of every membership server action: the actor, the parsed form, then the service call.
 * Membership errors become copy for the audience; once the service call succeeds, the route is
 * refreshed. Not a server action itself: call it from one.
 */
export async function runMembershipAction<S extends z.ZodType>({
  audience,
  formData,
  schema,
  visibleFields,
  perform,
  refreshOnError,
}: RunOptions<S>): Promise<ActionResult> {
  let user: SessionUser;
  try {
    user = audience === "admin" ? await requireRole("ADMIN") : await requireUser();
  } catch (error) {
    if (isAuthError(error)) return authErrorResult(error.code);
    throw error;
  }

  const failed = (error: unknown): ActionResult => {
    const mapped = toMembershipError(error);
    if (!(mapped instanceof MembershipError)) throw mapped;
    if (refreshOnError?.(mapped)) refresh();
    return membershipErrorResult(mapped, audience);
  };

  let formSchema: S;
  try {
    formSchema = typeof schema === "function" ? await schema(formData) : schema;
  } catch (error) {
    return failed(error);
  }

  const parsed = parseForm(formSchema, formData);
  if (!parsed.success) return invalidForm(parsed.fieldErrors, visibleFields);

  let result: ActionResult;
  try {
    result = await perform(parsed.data, { user, ipHash: await getRequestIpHash() });
  } catch (error) {
    return failed(error);
  }
  refresh();
  return result;
}
