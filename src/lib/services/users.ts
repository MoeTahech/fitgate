import "server-only";
import { z } from "zod";
import type { AppRole } from "@/lib/auth/constants";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const USERS_PAGE_SIZE = 25;

export const userListQuery = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});

export type UserListItem = { id: string; name: string; email: string; role: AppRole; createdAt: Date };

export async function listUsers(params: unknown): Promise<{
  users: UserListItem[];
  total: number;
  page: number;
  pageCount: number;
  query: string;
}> {
  await requireRole("ADMIN");
  const { q, page } = userListQuery.parse(params ?? {});
  const query = q ?? "";

  const where = {
    anonymizedAt: null,
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { email: { contains: query.toLowerCase() } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * USERS_PAGE_SIZE,
      take: USERS_PAGE_SIZE,
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    }),
    db.user.count({ where }),
  ]);

  return { users, total, page, pageCount: Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)), query };
}
