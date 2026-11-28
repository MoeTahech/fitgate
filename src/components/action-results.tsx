"use client";

import { createContext, startTransition, use, useActionState, useOptimistic, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { FormAlert } from "./form-alert";

/** What a row action returns; server actions written for `useActionState` fit as they are. */
export type ActionOutcome = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
};

export type RowAction = (previous: ActionOutcome, formData: FormData) => Promise<ActionOutcome>;

export type PendingAction = { key: string; message: string };

export type ActionResultMessage = { tone: "info" | "success" | "error"; text: string };

const IDLE: ActionOutcome = { status: "idle" };

export const ACTION_FAILED_MESSAGE = "Something went wrong. Please try again.";

/**
 * Message for the results region: the running action's pending text, else the outcome of the
 * last action. Errors fall back to the first field error, then to a generic retry message.
 */
export function describeActionResult(result: ActionOutcome, pending: PendingAction | null): ActionResultMessage | null {
  if (pending) return { tone: "info", text: pending.message };
  if (result.status === "success") return result.message ? { tone: "success", text: result.message } : null;
  if (result.status === "error") {
    const fieldError = result.fieldErrors ? Object.values(result.fieldErrors)[0] : undefined;
    return { tone: "error", text: result.message ?? fieldError ?? ACTION_FAILED_MESSAGE };
  }
  return null;
}

/**
 * What the results region shows for a form that keeps its own result: its message, never its
 * field errors (the form shows those on its fields), so an error with only field errors clears it.
 */
export function regionOutcome({ status, message, fieldErrors }: ActionOutcome): ActionOutcome {
  if (message !== undefined) return { status, message };
  if (status === "error" && fieldErrors && Object.keys(fieldErrors).length > 0) return IDLE;
  return { status };
}

type RunRequest = { action: RowAction; formData: FormData };
type RunOptions = RunRequest & { key: string; pendingMessage: string };
type ReportRequest = { outcome: ActionOutcome };

/**
 * Runs an action for `useActionState`, which would rethrow a rejection during render and replace
 * the page with the error boundary: a thrown error (network failure, unexpected server error)
 * becomes the generic retry message instead.
 */
export async function settleAction(action: RowAction, previous: ActionOutcome, formData: FormData): Promise<ActionOutcome> {
  try {
    return await action(previous, formData);
  } catch (error) {
    console.error("[action-results] action failed", error);
    return { status: "error", message: ACTION_FAILED_MESSAGE };
  }
}

async function runRowAction(_previous: ActionOutcome, request: RunRequest | ReportRequest): Promise<ActionOutcome> {
  if ("outcome" in request) return request.outcome;
  return settleAction(request.action, IDLE, request.formData);
}

type ActionResultsValue = {
  /** Runs `action` with `formData`; `key` names the trigger, `pendingMessage` shows meanwhile. */
  run: (options: RunOptions) => void;
  /**
   * For a form that keeps its own state (`useMembershipForm`) but whose message must outlive it:
   * call inside the transition that dispatches the form's action, to show `message` meanwhile.
   */
  announce: (pending: PendingAction) => void;
  /** Shows a form's outcome in the results region, without its field errors (`regionOutcome`). */
  report: (outcome: ActionOutcome) => void;
  /** Key of the action that is running, so its trigger can show a pending state. */
  pendingKey: string | null;
  /** The results region: `finalFocus` for a confirmed action that may remove its own trigger. */
  resultsRef: RefObject<HTMLDivElement | null>;
  result: ActionOutcome;
  pending: PendingAction | null;
};

const ActionResultsContext = createContext<ActionResultsValue | null>(null);

export function useActionResults(): ActionResultsValue {
  const value = use(ActionResultsContext);
  if (!value) throw new Error("useActionResults must be used inside <ActionResultsProvider>");
  return value;
}

/**
 * Owns the state of row actions above the rows they act on, so the result and the focus target
 * survive the refresh that moves or removes the row (and its trigger). Render `<ActionResults />`
 * once inside it, above the list.
 */
export function ActionResultsProvider({ children }: { children: ReactNode }) {
  const resultsRef = useRef<HTMLDivElement>(null);
  const [result, dispatch] = useActionState(runRowAction, IDLE);
  const [pending, setPending] = useOptimistic<PendingAction | null>(null);

  function run({ key, pendingMessage, action, formData }: RunOptions) {
    startTransition(() => {
      setPending({ key, message: pendingMessage });
      dispatch({ action, formData });
    });
  }

  function report(outcome: ActionOutcome) {
    startTransition(() => dispatch({ outcome: regionOutcome(outcome) }));
  }

  return (
    <ActionResultsContext
      value={{ run, announce: setPending, report, pendingKey: pending?.key ?? null, resultsRef, result, pending }}
    >
      {children}
    </ActionResultsContext>
  );
}

/** Always-mounted results region for the provider's row actions. */
export function ActionResults() {
  const { resultsRef, result, pending } = useActionResults();
  const message = describeActionResult(result, pending);
  return (
    <div ref={resultsRef} tabIndex={-1} className={cn("outline-none", message && "mb-3")}>
      <FormAlert tone={message?.tone ?? "info"}>{message?.text}</FormAlert>
    </div>
  );
}
