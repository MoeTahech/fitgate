import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { FreezeStatus, InviteStatus, MembershipStatus, PaymentStatus } from "@/generated/prisma/client";

export type StatusTone = "active" | "frozen" | "past-due" | "expired" | "cancelled" | "pending";

type StatusDisplay = { tone: StatusTone; label: string };

/** Status pill. Always carries a text label, so color is never the only signal. */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <Badge variant={`status-${tone}`}>{children}</Badge>;
}

const MEMBERSHIP_STATUS: Record<MembershipStatus, StatusDisplay> = {
  ACTIVE: { tone: "active", label: "Active" },
  PAST_DUE: { tone: "past-due", label: "Past due" },
  FROZEN: { tone: "frozen", label: "Frozen" },
  CANCELLED: { tone: "cancelled", label: "Cancelled" },
  EXPIRED: { tone: "expired", label: "Expired" },
};

export function MembershipStatusBadge({ status }: { status: MembershipStatus }) {
  const { tone, label } = MEMBERSHIP_STATUS[status];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

const INVITE_STATUS: Record<InviteStatus, StatusDisplay> = {
  PENDING: { tone: "pending", label: "Pending" },
  ACCEPTED: { tone: "active", label: "Accepted" },
  REVOKED: { tone: "cancelled", label: "Revoked" },
  EXPIRED: { tone: "expired", label: "Expired" },
};

export function InviteStatusBadge({ status }: { status: InviteStatus }) {
  const { tone, label } = INVITE_STATUS[status];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

const FREEZE_STATUS: Record<FreezeStatus, StatusDisplay> = {
  REQUESTED: { tone: "pending", label: "Requested" },
  APPROVED: { tone: "frozen", label: "Approved" },
  COMPLETED: { tone: "expired", label: "Completed" },
  REJECTED: { tone: "past-due", label: "Rejected" },
  CANCELLED: { tone: "cancelled", label: "Cancelled" },
};

export function FreezeStatusBadge({ status }: { status: FreezeStatus }) {
  const { tone, label } = FREEZE_STATUS[status];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

const PAYMENT_STATUS: Record<PaymentStatus, StatusDisplay> = {
  SUCCEEDED: { tone: "active", label: "Paid" },
  PARTIALLY_REFUNDED: { tone: "pending", label: "Partly refunded" },
  REFUNDED: { tone: "expired", label: "Refunded" },
  VOIDED: { tone: "cancelled", label: "Voided" },
  PENDING: { tone: "pending", label: "Pending" },
  FAILED: { tone: "past-due", label: "Failed" },
  DISPUTED: { tone: "past-due", label: "Disputed" },
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { tone, label } = PAYMENT_STATUS[status];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}
