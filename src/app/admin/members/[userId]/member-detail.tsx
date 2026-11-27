import { notFound } from "next/navigation";
import { DataTable } from "@/components/data-table";
import { DetailList, type DetailItem } from "@/components/detail-list";
import { EmptyState } from "@/components/empty-state";
import { PageHeader, SectionHeader } from "@/components/page-header";
import { MembershipStatusBadge, PaymentStatusBadge } from "@/components/status-badge";
import { TextLink } from "@/components/text-link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/auth/constants";
import { requirePageUser } from "@/lib/auth/session";
import { formatDay, periodText, pluralDays, recordPaymentNotice } from "@/lib/memberships-ui/display";
import { MEMBER_ROLE_LABELS, PAYMENT_METHOD_LABELS, TRIAL_KIND_LABELS } from "@/lib/memberships-ui/labels";
import { formatMoney } from "@/lib/money";
import {
  getMemberDetail,
  type AdminMembershipSummary,
  type AdminPaymentListItem,
  type MemberDetail,
  type OpenBaseView,
} from "@/lib/services/memberships/queries";
import { ExtendCard } from "../../memberships/extend-card";
import { RecordPaymentForm, type RecordPaymentPlanOption } from "./record-payment-form";

function membershipHref(membershipId: string): string {
  return `/admin/memberships/${membershipId}`;
}

function profileItems({ member, timeZone }: MemberDetail): DetailItem[] {
  const items: DetailItem[] = [
    { term: "Email", value: member.email },
    { term: "Role", value: ROLE_LABELS[member.role] },
    { term: "Email verified", value: member.emailVerified ? "Yes" : "No" },
    { term: "Joined", value: formatDay(member.createdAt, timeZone) },
  ];
  if (member.anonymized) items.push({ term: "Account", value: "Deleted" });
  return items;
}

function openBaseText(openBase: OpenBaseView | null): string {
  if (!openBase) return "No gym membership is running.";
  if (openBase.seatRole === "PARTNER") return `Running now: ${openBase.planName}, as the partner on someone else's membership.`;
  return `Running now: ${openBase.planName}, ${pluralDays(openBase.remainingDays)} left.`;
}

function RecordPaymentCard({ detail }: { detail: MemberDetail }) {
  const { openBase, plans } = detail.recordPayment;
  const options: RecordPaymentPlanOption[] = plans.map((plan) => ({
    id: plan.id,
    label: `${plan.name} · ${formatMoney(plan.priceCents, plan.currency)}`,
    notice: recordPaymentNotice(plan, openBase),
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Record payment
        </CardTitle>
        <CardDescription>
          A front-desk payment starts a new membership at the plan&apos;s price. {openBaseText(openBase)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">No plans are on offer right now.</p>
        ) : (
          <RecordPaymentForm userId={detail.member.id} plans={options} />
        )}
      </CardContent>
    </Card>
  );
}

function seatText(m: AdminMembershipSummary, memberId: string): string {
  const role = MEMBER_ROLE_LABELS[m.seat.role];
  const shared = m.seat.role === "PARTNER" && m.owner.id !== memberId ? `${role} of ${m.owner.name}` : role;
  return m.seat.endedAt && m.seat.role === "PARTNER" ? `${shared} (left)` : shared;
}

function Memberships({ detail, now }: { detail: MemberDetail; now: Date }) {
  const { memberships, timeZone, member } = detail;
  return (
    <section>
      <SectionHeader title="Memberships" />
      {memberships.length === 0 ? (
        <EmptyState title="No memberships yet" description="Record a payment to start one." />
      ) : (
        <DataTable
          label={`Memberships of ${member.name}`}
          rows={memberships}
          rowKey={(m) => m.id}
          columns={[
            {
              id: "plan",
              header: "Plan",
              grow: true,
              wrap: true,
              stackedLabel: false,
              cell: (m) => (
                <>
                  <p>
                    <TextLink href={membershipHref(m.id)}>{m.plan.name}</TextLink>
                  </p>
                  <p className="text-muted-foreground">{seatText(m, member.id)}</p>
                </>
              ),
            },
            { id: "status", header: "Status", cell: (m) => <MembershipStatusBadge status={m.status} /> },
            { id: "period", header: "Period", cell: (m) => periodText(m, timeZone, now) },
            { id: "credits", header: "Credits", cell: (m) => m.creditBalance },
          ]}
        />
      )}
    </section>
  );
}

/** Extend cards for the memberships the read model offers an extension on (running, front desk, owned). */
function Extensions({ detail }: { detail: MemberDetail }) {
  const extendable = detail.memberships.flatMap((m) =>
    m.extension ? [{ id: m.id, planName: m.plan.name, extension: m.extension }] : [],
  );
  if (extendable.length === 0) return null;
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title="Extend" description="Records a payment for one more billing period, from the current end." />
      {extendable.map((m) => (
        <ExtendCard key={m.id} membershipId={m.id} planName={m.planName} extension={m.extension} timeZone={detail.timeZone} />
      ))}
    </section>
  );
}

function Payments({ payments, timeZone, memberName }: { payments: readonly AdminPaymentListItem[]; timeZone: string; memberName: string }) {
  return (
    <section>
      <SectionHeader title="Payments" />
      {payments.length === 0 ? (
        <EmptyState title="No payments yet" />
      ) : (
        <DataTable
          label={`Payments of ${memberName}`}
          rows={payments}
          rowKey={(payment) => payment.id}
          columns={[
            {
              id: "payment",
              header: "Payment",
              cell: (payment) => (
                <>
                  <p className="font-medium">{formatMoney(payment.amountCents, payment.currency)}</p>
                  {payment.amountRefundedCents > 0 ? (
                    <p className="text-muted-foreground">Refunded {formatMoney(payment.amountRefundedCents, payment.currency)}</p>
                  ) : null}
                  <p className="text-muted-foreground">
                    {PAYMENT_METHOD_LABELS[payment.method]}
                    {payment.paidAt ? `, ${formatDay(payment.paidAt, timeZone)}` : ""}
                  </p>
                </>
              ),
            },
            {
              id: "plan",
              header: "Plan",
              grow: true,
              wrap: true,
              cell: (payment) =>
                payment.membershipId ? (
                  <p>
                    <TextLink href={membershipHref(payment.membershipId)}>{payment.planName ?? "Membership"}</TextLink>
                  </p>
                ) : (
                  <p>{payment.planName ?? "—"}</p>
                ),
            },
            { id: "status", header: "Status", cell: (payment) => <PaymentStatusBadge status={payment.status} /> },
            {
              id: "recorded",
              header: "Recorded by",
              cell: (payment) => (
                <>
                  <p>{payment.recordedByName ?? "System"}</p>
                  {payment.reference ? <p className="text-muted-foreground">Ref. {payment.reference}</p> : null}
                </>
              ),
            },
          ]}
        />
      )}
    </section>
  );
}

function TrialsUsed({ detail }: { detail: MemberDetail }) {
  if (detail.trialsUsed.length === 0) return null;
  return (
    <section>
      <SectionHeader title="Trials used" />
      <DataTable
        label={`Trials used by ${detail.member.name}`}
        rows={detail.trialsUsed}
        rowKey={(trial) => trial.membershipId}
        columns={[
          {
            id: "trial",
            header: "Trial",
            grow: true,
            wrap: true,
            stackedLabel: false,
            cell: (trial) => (
              <p>
                <TextLink href={membershipHref(trial.membershipId)}>{TRIAL_KIND_LABELS[trial.kind]}</TextLink>
              </p>
            ),
          },
          { id: "started", header: "Started", cell: (trial) => formatDay(trial.redeemedAt, detail.timeZone) },
        ]}
      />
    </section>
  );
}

/** One member for the admin: profile, record payment, memberships, extensions, payments, trials used. */
export async function MemberDetailView({ params }: { params: PageProps<"/admin/members/[userId]">["params"] }) {
  const { userId } = await params;
  await requirePageUser(`/admin/members/${encodeURIComponent(userId)}`, "ADMIN");
  const detail = await getMemberDetail(userId);
  if (!detail) notFound();
  const now = new Date();

  return (
    <>
      <PageHeader title={detail.member.name} description={detail.member.email} actions={<TextLink href="/admin/members">All members</TextLink>} />
      <div className="flex flex-col gap-8">
        <Card>
          <CardContent>
            <DetailList items={profileItems(detail)} />
          </CardContent>
        </Card>
        {detail.recordPayment.allowed ? <RecordPaymentCard detail={detail} /> : null}
        <Memberships detail={detail} now={now} />
        <Extensions detail={detail} />
        <Payments payments={detail.payments} timeZone={detail.timeZone} memberName={detail.member.name} />
        <TrialsUsed detail={detail} />
      </div>
    </>
  );
}
