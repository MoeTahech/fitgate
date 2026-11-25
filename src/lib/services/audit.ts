import "server-only";
import type { Prisma } from "@/generated/prisma/client";

export type AuditEntry = {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  details?: Prisma.InputJsonObject;
  ipHash?: string | null;
  /** Omitted: the column default. Services with an explicit `now` pass it. */
  createdAt?: Date;
};

/** Writes an audit row with the caller's transaction, so it commits or rolls back with the change. */
export function audit(tx: Prisma.TransactionClient, data: AuditEntry) {
  return tx.auditLog.create({
    data: { ...data, details: data.details ?? {}, ipHash: data.ipHash ?? null },
  });
}
