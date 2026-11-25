"use client";

import { useActionState, useEffect } from "react";
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
        <select
          name="role"
          defaultValue={role}
          aria-label={`Role for ${userName}`}
          className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`text-xs ${state.status === "error" ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
