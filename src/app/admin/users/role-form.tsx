"use client";

import { useActionState, useEffect } from "react";
import { InlineStatus } from "@/components/inline-status";
import { SubmitButton } from "@/components/submit-button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ROLE_LABELS, ROLES, type AppRole } from "@/lib/auth/constants";
import { hardNavigate } from "@/lib/auth/navigation";
import { changeRoleAction, type RoleFormState } from "./actions";

export function RoleForm({ userId, userName, role }: { userId: string; userName: string; role: AppRole }) {
  const [state, action, pending] = useActionState<RoleFormState, FormData>(changeRoleAction, { status: "idle" });

  useEffect(() => {
    if (state.status === "signed-out") hardNavigate("/sign-in");
  }, [state.status]);

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex items-center gap-2">
        <NativeSelect name="role" defaultValue={role} size="sm" aria-label={`Role for ${userName}`}>
          {ROLES.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {ROLE_LABELS[value]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <SubmitButton pending={pending} size="sm">
          {pending ? "Saving…" : "Save"}
        </SubmitButton>
      </div>
      {state.message ? <InlineStatus tone={state.status === "error" ? "error" : "success"}>{state.message}</InlineStatus> : null}
    </form>
  );
}
