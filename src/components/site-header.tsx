import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/session";

async function UserNav() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <Link href="/sign-in" className="text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Join
        </Link>
      </div>
    );
  }
  return (
    <nav className="flex items-center gap-4 text-sm">
      {user.role === "ADMIN" ? (
        <Link href="/admin/users" className="text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">
          Admin
        </Link>
      ) : null}
      <Link href="/account" className="font-medium text-zinc-900 dark:text-zinc-100">
        {user.name}
      </Link>
    </nav>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          FitGate
        </Link>
        <Suspense fallback={<div className="h-8 w-24" aria-hidden />}>
          <UserNav />
        </Suspense>
      </div>
    </header>
  );
}
