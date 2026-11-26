"use client";

import { MenuIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useEffectEvent, useRef, useState } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { NavItem } from "./nav";
import { NavLinks } from "./nav-links";
import { NavLinksFallback } from "./nav-links-fallback";

/**
 * Calls `onChange` when the pathname changes after mount, including navigations the menu's own
 * links don't see (browser back/forward). `usePathname` suspends under dynamic params, so render
 * inside `<Suspense>`.
 */
function OnPathnameChange({ onChange }: { onChange: () => void }) {
  const pathname = usePathname();
  const previous = useRef(pathname);
  const notify = useEffectEvent(onChange);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    notify();
  }, [pathname]);
  return null;
}

/** Menu for small screens: main links, admin sections for admins, and sign out. */
export function MobileNav({
  userName,
  items,
  adminItems,
}: {
  userName: string;
  items: readonly NavItem[];
  adminItems: readonly NavItem[];
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Suspense fallback={null}>
        <OnPathnameChange onChange={close} />
      </Suspense>
      <SheetTrigger render={<Button variant="header" size="icon" aria-label="Open menu" />}>
        <MenuIcon aria-hidden />
      </SheetTrigger>
      <SheetContent side="right" className="data-[side=right]:w-72">
        <SheetHeader className="border-b">
          <SheetTitle>Menu</SheetTitle>
          <SheetDescription>Signed in as {userName}</SheetDescription>
        </SheetHeader>
        <nav aria-label="Main" className="flex flex-col gap-1 px-2">
          <Suspense fallback={<NavLinksFallback items={items} variant="sheet" />}>
            <NavLinks items={items} variant="sheet" onNavigate={close} />
          </Suspense>
        </nav>
        {adminItems.length > 0 ? (
          <nav aria-labelledby="mobile-nav-admin" className="flex flex-col gap-1 px-2">
            <p id="mobile-nav-admin" className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Admin
            </p>
            <Suspense fallback={<NavLinksFallback items={adminItems} variant="sheet" />}>
              <NavLinks items={adminItems} variant="sheet" onNavigate={close} />
            </Suspense>
          </nav>
        ) : null}
        <SheetFooter className="border-t">
          <SignOutButton size="lg" fullWidth />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
