import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
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
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by name or email"
          aria-label="Search users"
          maxLength={100}
          className="h-10 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button type="submit" className="h-10 rounded-md border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700">
          Search
        </button>
      </form>

      <p className="mb-2 text-sm text-zinc-500">
        {total} {total === 1 ? "user" : "users"}
      </p>

      <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
        {users.map((user) => (
          <li key={user.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">{user.name}</p>
              <p className="truncate text-sm text-zinc-500">{user.email}</p>
            </div>
            <RoleForm userId={user.id} userName={user.name} role={user.role} />
          </li>
        ))}
        {users.length === 0 ? <li className="p-6 text-center text-sm text-zinc-500">No users found.</li> : null}
      </ul>

      {pageCount > 1 ? (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? <Link href={pageHref(page - 1)} className="underline">Previous</Link> : <span />}
          <span className="text-zinc-500">
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? <Link href={pageHref(page + 1)} className="underline">Next</Link> : <span />}
        </nav>
      ) : null}
    </>
  );
}

export default function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  return (
    <main>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Users</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />}>
        <UsersTable searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
