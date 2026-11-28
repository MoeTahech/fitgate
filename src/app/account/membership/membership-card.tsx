import type { ReactNode } from "react";
import { DetailList, type DetailItem } from "@/components/detail-list";
import { FreezeStatusBadge, MembershipStatusBadge } from "@/components/status-badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canCancelFreeze, formatDay, freezeDayCount, freezeDaysText, periodText, pluralDays } from "@/lib/memberships-ui/display";
import { MAX_FREEZE_DAYS } from "@/lib/services/memberships/schemas";
import type { MyMembership } from "@/lib/services/memberships/queries";
import { formatLocal, isoDate, zonedParts } from "@/lib/time";
import {
  CancelFreezeButton,
  FreezeRequestForm,
  InviteForm,
  InviteRowActions,
  LeaveMembershipButton,
  RemovePartnerButton,
} from "./membership-actions";

function Subsection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t pt-4">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      {children}
    </section>
  );
}

function Partners({ membership, timeZone }: { membership: MyMembership; timeZone: string }) {
  const { partners, pendingInvite, canInvite } = membership;
  if (partners.length === 0 && !pendingInvite && !canInvite) return null;
  return (
    <Subsection title="Partner">
      {partners.map((partner) => (
        <div key={partner.seatId} className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium wrap-anywhere">{partner.name}</p>
            <p className="text-sm text-muted-foreground">Joined {formatDay(partner.joinedAt, timeZone)}</p>
          </div>
          <RemovePartnerButton seatId={partner.seatId} name={partner.name} />
        </div>
      ))}
      {pendingInvite ? (
        <div className="flex flex-col gap-2">
          <div className="min-w-0">
            <p className="font-medium wrap-anywhere">{pendingInvite.email}</p>
            <p className="text-sm text-muted-foreground">
              Invited, waiting to join. The link works until {formatLocal(pendingInvite.expiresAt, timeZone)}.
            </p>
          </div>
          <InviteRowActions inviteId={pendingInvite.id} email={pendingInvite.email} />
        </div>
      ) : canInvite ? (
        <InviteForm membershipId={membership.id} />
      ) : null}
    </Subsection>
  );
}

function Freezes({ membership, timeZone, now }: { membership: MyMembership; timeZone: string; now: Date }) {
  const isOwner = membership.seat.role === "OWNER";
  const { freezes, freezeRequest } = membership;
  if (freezes.length === 0 && !freezeRequest) return null;
  return (
    <Subsection title="Freezes">
      {freezes.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {freezes.map((freeze) => (
            <li key={freeze.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <FreezeStatusBadge status={freeze.status} />
                <span className="wrap-anywhere">{freezeDaysText(freeze, timeZone)}</span>
              </div>
              {freeze.status === "REJECTED" && freeze.reason ? (
                <p className="text-sm text-muted-foreground wrap-anywhere">Reason: {freeze.reason}</p>
              ) : null}
              {isOwner && canCancelFreeze(freeze, now) ? (
                <div>
                  <CancelFreezeButton
                    freezeId={freeze.id}
                    approved={freeze.status === "APPROVED"}
                    daysText={pluralDays(freezeDayCount(freeze, timeZone))}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {freezeRequest ? (
        <FreezeRequestForm
          membershipId={membership.id}
          earliestStart={isoDate(zonedParts(freezeRequest.earliestStart, timeZone))}
          earliestLabel={formatDay(freezeRequest.earliestStart, timeZone)}
          maxDays={MAX_FREEZE_DAYS}
        />
      ) : null}
    </Subsection>
  );
}

/** A running membership the person holds a seat on: its status, period, and what they can do with it. */
export function MembershipCard({ membership, timeZone, now }: { membership: MyMembership; timeZone: string; now: Date }) {
  const isPartner = membership.seat.role === "PARTNER";

  const details: DetailItem[] = [{ term: "Period", value: periodText(membership, timeZone, now) }];
  if (membership.creditBalance !== null) details.push({ term: "Credits left", value: membership.creditBalance });
  if (isPartner) details.push({ term: "Shared by", value: membership.ownerName });

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={3} className="wrap-anywhere">
          {membership.plan.name}
        </CardTitle>
        <CardAction>
          <MembershipStatusBadge status={membership.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <DetailList items={details} />
        {isPartner ? (
          <div>
            <LeaveMembershipButton membershipId={membership.id} planName={membership.plan.name} ownerName={membership.ownerName} />
          </div>
        ) : (
          <Partners membership={membership} timeZone={timeZone} />
        )}
        <Freezes membership={membership} timeZone={timeZone} now={now} />
      </CardContent>
    </Card>
  );
}
