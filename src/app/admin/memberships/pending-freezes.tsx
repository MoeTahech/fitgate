import { ActionResults, ActionResultsProvider } from "@/components/action-results";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { TextLink } from "@/components/text-link";
import { requirePageUser } from "@/lib/auth/session";
import { formatDay, freezeDaysText } from "@/lib/memberships-ui/display";
import { listPendingFreezes } from "@/lib/services/memberships/queries";
import { ApproveFreezeButton, RejectFreezeButton } from "./row-actions";

/** Freeze requests waiting for a decision, soonest start first, with Approve and Reject. */
export async function PendingFreezes() {
  await requirePageUser("/admin/memberships", "ADMIN");
  const { freezes, timeZone } = await listPendingFreezes();

  return (
    <ActionResultsProvider>
      <ActionResults />
      {freezes.length === 0 ? (
        <EmptyState title="No freeze requests waiting" description="New requests show up here until they start." />
      ) : (
        <DataTable
          label="Pending freeze requests"
          rows={freezes}
          rowKey={(freeze) => freeze.id}
          columns={[
            {
              id: "member",
              header: "Member",
              grow: true,
              stackedLabel: false,
              cell: (freeze) => (
                <>
                  <p>
                    <TextLink href={`/admin/members/${freeze.owner.id}`}>{freeze.owner.name}</TextLink>
                  </p>
                  <p>
                    <TextLink href={`/admin/memberships/${freeze.membershipId}`}>{freeze.planName}</TextLink>
                  </p>
                  <p className="text-muted-foreground">Requested {formatDay(freeze.requestedAt, timeZone)}</p>
                </>
              ),
            },
            {
              id: "freeze",
              header: "Freeze",
              cell: (freeze) => (
                <>
                  <p>{freezeDaysText(freeze, timeZone)}</p>
                  <p className="text-muted-foreground">Current end {formatDay(freeze.currentPeriodEnd, timeZone)}</p>
                </>
              ),
            },
            {
              id: "actions",
              header: "Actions",
              hideHeader: true,
              align: "end",
              cell: (freeze) => (
                <div className="flex flex-wrap gap-2">
                  <ApproveFreezeButton freezeId={freeze.id} />
                  <RejectFreezeButton
                    freezeId={freeze.id}
                    description={`${freeze.owner.name} asked to freeze ${freeze.planName}: ${freezeDaysText(freeze, timeZone)}. Rejecting leaves the membership as it is.`}
                  />
                </div>
              ),
            },
          ]}
        />
      )}
    </ActionResultsProvider>
  );
}
