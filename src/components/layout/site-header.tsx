import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/session";
import { ACCOUNT_HREF, ADMIN_NAV, MAIN_NAV, navItemsFor, navLinkVariants } from "./nav";
import { NavLinks } from "./nav-links";
import { NavLinksFallback } from "./nav-links-fallback";
import { MobileNav } from "./mobile-nav";

async function UserNav() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/sign-in" className={navLinkVariants({ variant: "header" })}>
          Sign in
        </Link>
        <Link href="/sign-up" className={buttonVariants({ size: "sm" })}>
          Join
        </Link>
      </div>
    );
  }

  const items = navItemsFor(MAIN_NAV, user.role);
  const desktopItems = [...items, { href: ACCOUNT_HREF, label: user.name }];
  return (
    <>
      <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
        <Suspense fallback={<NavLinksFallback items={desktopItems} variant="header" />}>
          <NavLinks items={desktopItems} variant="header" />
        </Suspense>
      </nav>
      <div className="md:hidden">
        <MobileNav
          userName={user.name}
          items={[...items, { href: ACCOUNT_HREF, label: "Account" }]}
          adminItems={user.role === "ADMIN" ? ADMIN_NAV : []}
        />
      </div>
    </>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-header-border bg-header text-header-foreground">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <Link href="/" className="rounded-md text-lg font-bold tracking-tight">
          Fit<span className="text-header-active">Gate</span>
        </Link>
        <Suspense fallback={<div className="h-9 w-24" aria-hidden />}>
          <UserNav />
        </Suspense>
      </div>
    </header>
  );
}
