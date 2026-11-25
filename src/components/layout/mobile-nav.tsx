"use client";

import { MenuIcon } from "lucide-react";
import { Suspense, useLayoutEffect, useState } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { NavItem } from "./nav";
import { NavLinks } from "./nav-links";
import { NavLinksFallback } from "./nav-links-fallback";

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

  useLayoutEffect(() => () => setOpen(false), []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="header" size="icon" aria-label="Open menu" />}>
        <MenuIcon aria-hidden />
      </SheetTrigger>
      <SheetContent side="right" className="w-72">
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
