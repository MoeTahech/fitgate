import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader, SectionHeader } from "@/components/page-header";
import { InviteStatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listTrainerInvites } from "@/lib/services/trainer-invites";
import { formatLocal } from "@/lib/time";
import { CreateInviteForm, InviteActions } from "./invite-forms";

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
        <SectionHeader title="Invites" />
        {invites.length === 0 ? (
          <EmptyState title="No invites yet" description="Invites you send appear here." />
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Email</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4">Invited</TableHead>
                  <TableHead className="px-4">Expires</TableHead>
                  <TableHead className="px-4 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell className="px-4 py-3 font-medium">{invite.email}</TableCell>
                    <TableCell className="px-4 py-3">
                      <InviteStatusBadge status={invite.status} />
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <p>{formatLocal(invite.createdAt, timeZone)}</p>
                      <p className="text-muted-foreground">by {invite.invitedByName}</p>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-muted-foreground">
                      {invite.status === "PENDING" ? formatLocal(invite.expiresAt, timeZone) : "—"}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      {invite.status === "PENDING" || invite.status === "EXPIRED" ? (
                        <InviteActions
                          inviteId={invite.id}
                          email={invite.email}
                          canRevoke={invite.status === "PENDING"}
                          canResend
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
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
