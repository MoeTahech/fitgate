import { safeRedirectPath } from "./redirect";

export type Navigate = (path: string) => void;

/**
 * Full document navigation. Used after the auth state changes (sign-in, sign-out, own role
 * change): client navigations keep the root layout and the browser-cached `getCurrentUser`
 * result, which would show the previous user.
 */
export const hardNavigate: Navigate = (path) => {
  window.location.replace(path);
};

type AuthCall = () => Promise<{ error?: unknown }>;

/** Signs out, then leaves the page. Returns false (without navigating) if sign-out failed. */
export async function signOutAndRedirect(
  signOut: AuthCall,
  options: { to?: string; navigate?: Navigate } = {},
): Promise<boolean> {
  try {
    const { error } = await signOut();
    if (error) return false;
  } catch {
    return false;
  }
  (options.navigate ?? hardNavigate)(safeRedirectPath(options.to, "/sign-in"));
  return true;
}
