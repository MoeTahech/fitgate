import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { InviteStatus, MembershipStatus } from "@/generated/prisma/client";

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
