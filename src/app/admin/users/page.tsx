import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth/session";
import { listUsers } from "@/lib/services/users";
import { RoleForm } from "./role-form";

export const metadata: Metadata = { title: "Users" };

async function UsersTable({ searchParams }: { searchParams: PageProps<"/admin/users">["searchParams"] }) {
  const raw = await searchParams;
  const returnTo = `/admin/users${typeof raw.q === "string" && raw.q ? `?q=${encodeURIComponent(raw.q)}` : ""}`;
  await requirePageUser(returnTo, "ADMIN");
  const { users, total, page, pageCount, query } = await listUsers({ q: raw.q, page: raw.page });

  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (target > 1) params.set("page", String(target));
    const search = params.toString();
    return `/admin/users${search ? `?${search}` : ""}`;
  };

  return (
    <>
      <form role="search" className="mb-4 flex gap-2">
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by name or email"
          aria-label="Search users"
          maxLength={100}
          className="flex-1"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <p className="mb-2 text-sm text-muted-foreground">
        {total} {total === 1 ? "user" : "users"}
      </p>

      {users.length === 0 ? (
        <EmptyState title="No users found" description={query ? "Try a different name or email." : undefined} />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">User</TableHead>
                <TableHead className="px-4 text-right">Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="max-w-64 px-4 py-3">
                    <p className="truncate font-medium">{user.name}</p>
                    <p className="truncate text-muted-foreground">{user.email}</p>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <RoleForm userId={user.id} userName={user.name} role={user.role} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Pagination page={page} pageCount={pageCount} hrefFor={pageHref} />
    </>
  );
}

export default function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  return (
    <main>
      <PageHeader title="Users" />
      <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
        <UsersTable searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
