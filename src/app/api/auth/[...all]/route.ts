import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/server";

const handlers = toNextJsHandler(auth);

/** Better Auth's limiter sets only `X-Retry-After`; add the standard header. */
function withRetryAfter(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const response = await handler(request);
    const retryAfter = response.headers.get("X-Retry-After");
    if (response.status !== 429 || !retryAfter || response.headers.has("Retry-After")) return response;

    const patched = new Response(response.body, response);
    patched.headers.set("Retry-After", retryAfter);
    return patched;
  };
}

export const GET = withRetryAfter(handlers.GET);
export const POST = withRetryAfter(handlers.POST);
