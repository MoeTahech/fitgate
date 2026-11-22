import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePageUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listTrainerInvites } from "@/lib/services/trainer-invites";
import { CreateInviteForm, InviteActions } from "./invite-forms";

export const metadata: Metadata = { title: "Trainers" };

const STATUS_STYLES = {
  PENDING: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  ACCEPTED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  REVOKED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  EXPIRED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
} as const;

async function TrainerInvites() {
  await requirePageUser("/admin/trainers", "ADMIN");
  const [invites, settings] = await Promise.all([
    listTrainerInvites(),
    db.gymSettings.findUnique({ where: { id: 1 }, select: { timeZone: true } }),
  ]);
  const formatDate = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: settings?.timeZone ?? "Asia/Beirut",
  });

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <CreateInviteForm />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Invites</h2>
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {invites.map((invite) => (
            <li key={invite.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2">
                  <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{invite.email}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[invite.status]}`}>
                    {invite.status.toLowerCase()}
                  </span>
                </p>
                <p className="text-sm text-zinc-500">
                  Invited by {invite.invitedByName} on {formatDate.format(invite.createdAt)}
                  {invite.status === "PENDING" ? ` · expires ${formatDate.format(invite.expiresAt)}` : null}
                </p>
              </div>
              {invite.status === "PENDING" || invite.status === "EXPIRED" ? (
                <InviteActions
                  inviteId={invite.id}
                  canRevoke={invite.status === "PENDING"}
                  canResend
                />
              ) : null}
            </li>
          ))}
          {invites.length === 0 ? <li className="p-6 text-center text-sm text-zinc-500">No invites yet.</li> : null}
        </ul>
      </section>
    </div>
  );
}

export default function AdminTrainersPage() {
  return (
    <main>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Trainers</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />}>
        <TrainerInvites />
      </Suspense>
    </main>
  );
}
