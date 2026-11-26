import { Suspense } from "react";
import { ADMIN_NAV } from "./nav";
import { NavLinks } from "./nav-links";
import { NavLinksFallback } from "./nav-links-fallback";

/** Admin section sidebar from `md` up; smaller screens reach these links through the mobile menu. */
export function AdminNav() {
  return (
    <nav aria-label="Admin" className="hidden md:block">
      <div className="sticky top-6 flex flex-col gap-1">
        <Suspense fallback={<NavLinksFallback items={ADMIN_NAV} variant="sidebar" />}>
          <NavLinks items={ADMIN_NAV} variant="sidebar" />
        </Suspense>
      </div>
    </nav>
  );
}
