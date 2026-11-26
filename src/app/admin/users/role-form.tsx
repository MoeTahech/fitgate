"use client";

import { useActionState, useEffect, useId, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { InlineStatus } from "@/components/inline-status";
import { SubmitButton } from "@/components/submit-button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ROLE_LABELS, ROLES, type AppRole } from "@/lib/auth/constants";
import { hardNavigate } from "@/lib/auth/navigation";
import { changeRoleAction, type RoleFormState } from "./actions";
import { needsSelfDemotionConfirm, parseRole } from "./role-confirm";

export function RoleForm({
  userId,
  userName,
  role,
  isSelf,
}: {
  userId: string;
  userName: string;
  role: AppRole;
  isSelf: boolean;
}) {
  const formId = useId();
  const [state, action, pending] = useActionState<RoleFormState, FormData>(changeRoleAction, { status: "idle" });
  const [selected, setSelected] = useState<AppRole>(role);

  useEffect(() => {
    if (state.status === "signed-out") hardNavigate("/sign-in");
  }, [state.status]);

  function syncAfterReset(event: FormEvent<HTMLFormElement>) {
    const select = event.currentTarget.elements.namedItem("role");
    // The reset event fires before the fields reset; read the select once it has.
    queueMicrotask(() => {
      if (select instanceof HTMLSelectElement) setSelected(parseRole(select.value) ?? role);
    });
  }

  return (
    <form id={formId} action={action} onReset={syncAfterReset} className="flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex items-center gap-2">
        <NativeSelect
          name="role"
          defaultValue={role}
          onChange={(event) => setSelected(parseRole(event.target.value) ?? role)}
          size="sm"
          aria-label={`Role for ${userName}`}
        >
          {ROLES.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {ROLE_LABELS[value]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {needsSelfDemotionConfirm({ isSelf, selected }) ? (
          <ConfirmDialog
            triggerLabel="Save"
            pendingLabel="Saving…"
            triggerVariant="default"
            triggerSize="sm"
            title="Remove your own admin access?"
            description="You'll be signed out on all your devices and lose access to the admin area. Only another admin can give it back."
            confirmLabel="Change my role"
            tone="destructive"
            form={formId}
            pending={pending}
          />
        ) : (
          <SubmitButton pending={pending} size="sm">
            {pending ? "Saving…" : "Save"}
          </SubmitButton>
        )}
      </div>
      <InlineStatus tone={state.status === "error" ? "error" : "success"}>{state.message}</InlineStatus>
    </form>
  );
}
