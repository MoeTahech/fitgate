import type { Metadata } from "next";
import { Suspense } from "react";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader, SectionHeader } from "@/components/page-header";
import { InviteStatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePageUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listTrainerInvites } from "@/lib/services/trainer-invites";
import { formatLocal } from "@/lib/time";
import { CreateInviteForm, InviteActions, InviteActionsProvider, InviteResults } from "./invite-forms";

export const metadata: Metadata = { title: "Trainers" };

async function TrainerInvites() {
  await requirePageUser("/admin/trainers", "ADMIN");
  const [invites, settings] = await Promise.all([
    listTrainerInvites(),
    db.gymSettings.findUnique({ where: { id: 1 }, select: { timeZone: true } }),
  ]);
  const timeZone = settings?.timeZone ?? "Asia/Beirut";

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardContent>
          <CreateInviteForm />
        </CardContent>
      </Card>

      <section>
        <InviteActionsProvider>
          <SectionHeader title="Invites" />
          <InviteResults />
          {invites.length === 0 ? (
            <EmptyState title="No invites yet" description="Invites you send appear here." />
          ) : (
            <DataTable
              label="Trainer invites"
              rows={invites}
              rowKey={(invite) => invite.id}
              columns={[
                {
                  id: "invite",
                  header: "Invite",
                  grow: true,
                  stackedLabel: false,
                  cell: (invite) => (
                    <>
                      <p className="font-medium">{invite.email}</p>
                      <p className="text-muted-foreground">
                        Invited {formatLocal(invite.createdAt, timeZone)} by {invite.invitedByName}
                      </p>
                    </>
                  ),
                },
                { id: "status", header: "Status", cell: (invite) => <InviteStatusBadge status={invite.status} /> },
                {
                  id: "expires",
                  header: "Expires",
                  cell: (invite) => (
                    <p className="text-muted-foreground">
                      {invite.status === "PENDING" ? formatLocal(invite.expiresAt, timeZone) : "—"}
                    </p>
                  ),
                },
                {
                  id: "actions",
                  header: "Actions",
                  hideHeader: true,
                  align: "end",
                  cell: (invite) =>
                    invite.status === "PENDING" || invite.status === "EXPIRED" ? (
                      <InviteActions
                        inviteId={invite.id}
                        email={invite.email}
                        canRevoke={invite.status === "PENDING"}
                        canResend
                      />
                    ) : null,
                },
              ]}
            />
          )}
        </InviteActionsProvider>
      </section>
    </div>
  );
}

export default function AdminTrainersPage() {
  return (
    <main>
      <PageHeader title="Trainers" />
      <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
        <TrainerInvites />
      </Suspense>
    </main>
  );
}
