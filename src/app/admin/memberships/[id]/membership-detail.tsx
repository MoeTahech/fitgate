import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionResults, ActionResultsProvider } from "@/components/action-results";
import { DataTable } from "@/components/data-table";
import { DetailList, type DetailItem } from "@/components/detail-list";
import { EmptyState } from "@/components/empty-state";
import { PageHeader, SectionHeader } from "@/components/page-header";
import { FreezeStatusBadge, InviteStatusBadge, MembershipStatusBadge, membershipStatusLabel } from "@/components/status-badge";
import { TextLink } from "@/components/text-link";
import { Card, CardContent } from "@/components/ui/card";
import { requirePageUser } from "@/lib/auth/session";
import { canCancelFreeze, formatDay, freezeDayCount, freezeDaysText, periodText, pluralDays } from "@/lib/memberships-ui/display";
import { CREDIT_REASON_LABELS, MEMBER_ROLE_LABELS, MEMBERSHIP_SOURCE_LABELS } from "@/lib/memberships-ui/labels";
import { getMembershipDetail, type MembershipDetail, type MembershipDetailInvite } from "@/lib/services/memberships/queries";
import { formatLocal } from "@/lib/time";
import { ExtendCard } from "../extend-card";
import { ApproveFreezeButton, CancelFreezeButton, RejectFreezeButton, RemovePartnerButton, RevokeInviteButton } from "../row-actions";
import { PaymentsSection } from "./payments-section";

type Membership = MembershipDetail["membership"];

function memberHref(userId: string): string {
  return `/admin/members/${userId}`;
}

function Lines({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-0.5">{children}</div>;
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground">{children}</p>;
}

function summaryItems({ membership: m, timeZone }: MembershipDetail, now: Date): DetailItem[] {
  const items: DetailItem[] = [
    {
      term: "Status",
      value:
        m.storedStatus === m.status ? (
          <MembershipStatusBadge status={m.status} />
        ) : (
          <span className="inline-flex flex-wrap items-center gap-2">
            <MembershipStatusBadge status={m.status} />
            <span className="font-normal text-muted-foreground">Stored as {membershipStatusLabel(m.storedStatus)}</span>
          </span>
        ),
    },
    { term: "Source", value: MEMBERSHIP_SOURCE_LABELS[m.source] },
    { term: "Period", value: periodText(m, timeZone, now) },
    { term: "Created", value: `${formatLocal(m.createdAt, timeZone)}${m.createdByName ? ` by ${m.createdByName}` : ""}` },
  ];
  if (m.endedAt) items.push({ term: "Ended", value: formatLocal(m.endedAt, timeZone) });
  if (m.cancelAtPeriodEnd) items.push({ term: "Renewal", value: "Cancels at the period end" });
  return items;
}

function isRunning(m: Membership): boolean {
  return m.endedAt === null;
}

function Seats({ detail }: { detail: MembershipDetail }) {
  const { seats, membership, timeZone } = detail;
  return (
    <section>
      <SectionHeader title="Seats" />
      <DataTable
        label="Seats"
        rows={seats}
        rowKey={(seat) => seat.id}
        columns={[
          {
            id: "person",
            header: "Person",
            grow: true,
            stackedLabel: false,
            cell: (seat) => (
              <>
                <p>
                  <TextLink href={memberHref(seat.user.id)}>{seat.user.name}</TextLink>
                </p>
                <p className="text-muted-foreground">{seat.user.email}</p>
              </>
            ),
          },
          { id: "role", header: "Role", cell: (seat) => MEMBER_ROLE_LABELS[seat.role] },
          { id: "joined", header: "Joined", cell: (seat) => formatDay(seat.joinedAt, timeZone) },
          { id: "ended", header: "Ended", cell: (seat) => (seat.endedAt ? formatDay(seat.endedAt, timeZone) : null) },
          {
            id: "actions",
            header: "Actions",
            hideHeader: true,
            align: "end",
            cell: (seat) =>
              seat.role === "PARTNER" && seat.endedAt === null && isRunning(membership) ? (
                <RemovePartnerButton seatId={seat.id} name={seat.user.name} />
              ) : null,
          },
        ]}
      />
    </section>
  );
}

function inviteOutcome(invite: MembershipDetailInvite, timeZone: string): string {
  if (invite.acceptedAt) return `Accepted${invite.acceptedByName ? ` by ${invite.acceptedByName}` : ""}, ${formatLocal(invite.acceptedAt, timeZone)}`;
  if (invite.revokedAt) {
    const by = invite.revokedBySystem ? "the system when the membership ended" : (invite.revokedByName ?? "staff");
    return `Revoked by ${by}, ${formatLocal(invite.revokedAt, timeZone)}`;
  }
  return `Link works until ${formatLocal(invite.expiresAt, timeZone)}`;
}

function Invites({ detail }: { detail: MembershipDetail }) {
  const { invites, membership, timeZone } = detail;
  if (invites.length === 0) return null;
  return (
    <section>
      <SectionHeader title="Invites" />
      <DataTable
        label="Partner invites"
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
                <p className="text-muted-foreground">{inviteOutcome(invite, timeZone)}</p>
              </>
            ),
          },
          { id: "status", header: "Status", cell: (invite) => <InviteStatusBadge status={invite.status} /> },
          { id: "sent", header: "Sent", cell: (invite) => formatDay(invite.createdAt, timeZone) },
          {
            id: "actions",
            header: "Actions",
            hideHeader: true,
            align: "end",
            cell: (invite) =>
              invite.status === "PENDING" && isRunning(membership) ? <RevokeInviteButton inviteId={invite.id} email={invite.email} /> : null,
          },
        ]}
      />
    </section>
  );
}

function Freezes({ detail, now }: { detail: MembershipDetail; now: Date }) {
  const { freezes, membership, timeZone } = detail;
  if (freezes.length === 0) return null;
  const running = isRunning(membership);
  return (
    <section>
      <SectionHeader title="Freezes" />
      <DataTable
        label="Freezes"
        rows={freezes}
        rowKey={(freeze) => freeze.id}
        columns={[
          {
            id: "freeze",
            header: "Freeze",
            cell: (freeze) => (
              <Lines>
                <p>{freezeDaysText(freeze, timeZone)}</p>
                <div>
                  <FreezeStatusBadge status={freeze.status} />
                </div>
              </Lines>
            ),
          },
          {
            id: "history",
            header: "History",
            grow: true,
            cell: (freeze) => (
              <Lines>
                <p>
                  Requested {formatDay(freeze.requestedAt, timeZone)} by {freeze.requestedByName}
                </p>
                {freeze.decidedAt ? (
                  <Muted>
                    Decided {formatDay(freeze.decidedAt, timeZone)}
                    {freeze.decidedByName ? ` by ${freeze.decidedByName}` : ""}
                  </Muted>
                ) : null}
                {freeze.reason ? <Muted>Reason: {freeze.reason}</Muted> : null}
              </Lines>
            ),
          },
          {
            id: "actions",
            header: "Actions",
            hideHeader: true,
            align: "end",
            cell: (freeze) => {
              if (running && freeze.status === "REQUESTED") {
                return (
                  <div className="flex flex-wrap gap-2">
                    <ApproveFreezeButton freezeId={freeze.id} />
                    <RejectFreezeButton
                      freezeId={freeze.id}
                      description={`${freezeDaysText(freeze, timeZone)}. Rejecting leaves the membership as it is.`}
                    />
                  </div>
                );
              }
              if (running && freeze.status === "APPROVED" && canCancelFreeze(freeze, now)) {
                return <CancelFreezeButton freezeId={freeze.id} daysText={pluralDays(freezeDayCount(freeze, timeZone))} />;
              }
              return null;
            },
          },
        ]}
      />
    </section>
  );
}

function Credits({ detail }: { detail: MembershipDetail }) {
  const { credits, timeZone } = detail;
  if (!credits) return null;
  return (
    <section>
      <SectionHeader title="Credits" description={`${credits.balance} left.`} />
      {credits.entries.length === 0 ? (
        <EmptyState title="No credit changes yet" />
      ) : (
        <DataTable
          label="Credit ledger"
          rows={credits.entries}
          rowKey={(entry) => entry.id}
          columns={[
            { id: "when", header: "When", cell: (entry) => formatLocal(entry.createdAt, timeZone) },
            { id: "change", header: "Change", cell: (entry) => (entry.delta > 0 ? `+${entry.delta}` : `−${Math.abs(entry.delta)}`) },
            { id: "reason", header: "Reason", grow: true, cell: (entry) => <p>{CREDIT_REASON_LABELS[entry.reason]}</p> },
            { id: "by", header: "By", cell: (entry) => entry.actorName ?? "System" },
          ]}
        />
      )}
    </section>
  );
}

function AuditTrail({ detail }: { detail: MembershipDetail }) {
  const { audit, timeZone } = detail;
  return (
    <section>
      <SectionHeader title="Audit trail" description="The membership and its payments, freezes, and invites, newest first." />
      {audit.length === 0 ? (
        <EmptyState title="No audit entries" />
      ) : (
        <DataTable
          label="Audit trail"
          rows={audit}
          rowKey={(entry) => entry.id}
          columns={[
            {
              id: "action",
              header: "Action",
              cell: (entry) => (
                <>
                  <p>{entry.action}</p>
                  <p className="text-muted-foreground">{entry.actorName ? `by ${entry.actorName}` : "by the system"}</p>
                </>
              ),
            },
            { id: "when", header: "When", cell: (entry) => formatLocal(entry.createdAt, timeZone) },
            {
              id: "details",
              header: "Details",
              grow: true,
              cell: (entry) => <p className="font-mono text-xs">{JSON.stringify(entry.details)}</p>,
            },
          ]}
        />
      )}
    </section>
  );
}

/** One membership for the admin: summary, extend, seats, invites, payments with corrections, freezes, credits, audit. */
export async function MembershipDetailView({ params }: { params: PageProps<"/admin/memberships/[id]">["params"] }) {
  const { id } = await params;
  await requirePageUser(`/admin/memberships/${encodeURIComponent(id)}`, "ADMIN");
  const detail = await getMembershipDetail(id);
  if (!detail) notFound();
  const now = new Date();
  const { membership, timeZone } = detail;

  return (
    <>
      <PageHeader
        title={membership.plan.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>
              Owned by <TextLink href={memberHref(membership.owner.id)}>{membership.owner.name}</TextLink>
            </span>
            <MembershipStatusBadge status={membership.status} />
          </span>
        }
        actions={<TextLink href="/admin/memberships">All memberships</TextLink>}
      />
      <ActionResultsProvider>
        <ActionResults />
        <div className="flex flex-col gap-8">
          <Card>
            <CardContent>
              <DetailList items={summaryItems(detail, now)} />
            </CardContent>
          </Card>
          {membership.extension ? (
            <ExtendCard membershipId={membership.id} planName={membership.plan.name} extension={membership.extension} timeZone={timeZone} />
          ) : null}
          <Seats detail={detail} />
          <Invites detail={detail} />
          <PaymentsSection
            payments={detail.payments}
            membership={{ status: membership.status, currentPeriodStart: membership.currentPeriodStart }}
            timeZone={timeZone}
            now={now}
          />
          <Freezes detail={detail} now={now} />
          <Credits detail={detail} />
          <AuditTrail detail={detail} />
        </div>
      </ActionResultsProvider>
    </>
  );
}
