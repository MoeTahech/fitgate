"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { signOutAndRedirect } from "@/lib/auth/navigation";

export function SignOutButton({ className, redirectTo = "/sign-in" }: { className?: string; redirectTo?: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setPending(true);
    setFailed(false);
    if (!(await signOutAndRedirect(() => authClient.signOut(), { to: redirectTo }))) {
      setPending(false);
      setFailed(true);
    }
  }

  return (
    <>
      <button type="button" onClick={signOut} disabled={pending} className={className}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          Couldn&apos;t sign you out. Check your connection and try again.
        </p>
      ) : null}
    </>
  );
}
