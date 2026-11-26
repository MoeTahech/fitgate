import { EmptyState } from "@/components/empty-state";
import { SectionHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TrialKind } from "@/generated/prisma/client";
import { ActionResults, ActionResultsProvider } from "@/components/action-results";
import { requirePageUser } from "@/lib/auth/session";
import { formatDay } from "@/lib/memberships-ui/display";
import { TRIAL_KIND_LABELS } from "@/lib/memberships-ui/labels";
import { formatMoney } from "@/lib/money";
import { getMyMemberships, getMyTrialEligibility, listJoinablePlans, type JoinablePlan } from "@/lib/services/memberships/queries";
import type { TrialEligibility } from "@/lib/services/memberships/trials";
import { formatLocalTime } from "@/lib/time";
import { StartTrialButton } from "./membership-actions";
import { MembershipCard } from "./membership-card";
import { PastMemberships, PaymentHistory } from "./membership-history";

type TrialOffer = { kind: TrialKind; eligibility: TrialEligibility };

const TRIAL_KINDS: readonly TrialKind[] = ["GYM", "CLASS"];

/** Eligible trials, and the two reasons worth explaining; any other reason hides the trial. */
function visibleTrials(trials: Record<TrialKind, TrialEligibility>): TrialOffer[] {
  return TRIAL_KINDS.map((kind) => ({ kind, eligibility: trials[kind] })).filter(
    ({ eligibility }) =>
      eligibility.eligible || eligibility.reason === "CLOSED_FOR_TODAY" || eligibility.reason === "EMAIL_NOT_VERIFIED",
  );
}

function trialCopy(kind: TrialKind, eligibility: TrialEligibility, timeZone: string) {
  const label = TRIAL_KIND_LABELS[kind];
  if (!eligibility.eligible) {
    return {
      summary:
        eligibility.reason === "EMAIL_NOT_VERIFIED"
          ? `Verify your email address to start your ${label}. We emailed you a link.`
          : `The gym is closed for the rest of today, so your ${label} can't start now. Try again on a day it's open.`,
      dialog: null,
    };
  }
  if (kind === "GYM") {
    const closing = formatLocalTime(eligibility.endsAt, timeZone);
    return {
      summary: `Train today, free. Valid today until closing (${closing}); it can be used once.`,
      dialog: { title: `Start your ${label} now?`, description: `It's valid today until closing (${closing}) and can be used once.` },
    };
  }
  const until = formatDay(eligibility.endsAt, timeZone);
  return {
    summary: `1 class credit, valid 7 days (until ${until}). It can be used once.`,
    dialog: { title: `Start your ${label} now?`, description: `You get 1 class credit, valid 7 days (until ${until}). It can be used once.` },
  };
}

function TrialCards({ offers, timeZone }: { offers: readonly TrialOffer[]; timeZone: string }) {
  if (offers.length === 0) return null;
  return (
    <section>
      <SectionHeader title="Free trials" description="Each trial can be used once." />
      <div className="flex flex-col gap-4">
        {offers.map(({ kind, eligibility }) => {
          const { summary, dialog } = trialCopy(kind, eligibility, timeZone);
          return (
            <Card key={kind}>
              <CardHeader>
                <CardTitle role="heading" aria-level={3}>
                  {TRIAL_KIND_LABELS[kind]}
                </CardTitle>
                <CardDescription>{summary}</CardDescription>
              </CardHeader>
              {dialog ? (
                <CardContent>
                  <StartTrialButton kind={kind} label={`Start ${TRIAL_KIND_LABELS[kind]}`} {...dialog} />
                </CardContent>
              ) : null}
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function JoinAtFrontDesk({ plans }: { plans: readonly JoinablePlan[] }) {
  return (
    <section>
      <SectionHeader title="Join at the front desk" description="Visit the front desk to join. They'll set up your membership there." />
      {plans.length === 0 ? (
        <EmptyState title="No plans on offer right now" description="Ask at the front desk about joining." />
      ) : (
        <Card>
          <CardContent>
            <ul className="flex flex-col gap-4">
              {plans.map((plan) => (
                <li key={plan.id} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="font-medium wrap-anywhere">{plan.name}</span>
                    <span className="text-muted-foreground">{formatMoney(plan.priceCents, plan.currency)}</span>
                  </div>
                  {plan.description ? <p className="text-sm text-muted-foreground wrap-anywhere">{plan.description}</p> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

export async function MembershipView() {
  await requirePageUser("/account/membership");
  const [{ timeZone, current, past, payments }, trials, plans] = await Promise.all([
    getMyMemberships(),
    getMyTrialEligibility(),
    listJoinablePlans(),
  ]);
  const now = new Date();

  const offers = visibleTrials(trials);
  const hasBase = current.some((membership) => membership.plan.type === "BASE");

  return (
    <ActionResultsProvider>
      <ActionResults />
      <div className="flex flex-col gap-8">
        {current.length === 0 ? (
          <EmptyState
            title={past.length > 0 ? "No current membership" : "No membership yet"}
            description={offers.length > 0 ? "Start a free trial below, or visit the front desk to join." : "Visit the front desk to join."}
          />
        ) : (
          <section>
            <SectionHeader title="Current" />
            <div className="flex flex-col gap-4">
              {current.map((membership) => (
                <MembershipCard key={membership.id} membership={membership} timeZone={timeZone} now={now} />
              ))}
            </div>
          </section>
        )}
        <TrialCards offers={offers} timeZone={timeZone} />
        {hasBase ? null : <JoinAtFrontDesk plans={plans} />}
        <PaymentHistory payments={payments} timeZone={timeZone} />
        <PastMemberships memberships={past} timeZone={timeZone} now={now} />
      </div>
    </ActionResultsProvider>
  );
}
