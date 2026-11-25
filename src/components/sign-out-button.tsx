"use client";

import { useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { signOutAndRedirect } from "@/lib/auth/navigation";

type ButtonProps = ComponentProps<typeof Button>;

export function SignOutButton({
  redirectTo = "/sign-in",
  variant = "outline",
  size,
  fullWidth = false,
}: {
  redirectTo?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  fullWidth?: boolean;
}) {
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
    <div className={fullWidth ? "flex w-full flex-col gap-2" : "flex flex-col items-start gap-2"}>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={signOut}
        disabled={pending}
        aria-busy={pending || undefined}
        className={fullWidth ? "w-full" : undefined}
      >
        {pending ? "Signing out…" : "Sign out"}
      </Button>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t sign you out. Check your connection and try again.
        </p>
      ) : null}
    </div>
  );
}
