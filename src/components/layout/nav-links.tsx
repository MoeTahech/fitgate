"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavItemActive, navLinkVariants, type NavItem, type NavLinkVariant } from "./nav";

/**
 * Nav links with the current page marked. `usePathname` suspends under dynamic params, so
 * render inside `<Suspense fallback={<NavLinksFallback … />}>`.
 */
export function NavLinks({
  items,
  variant,
  onNavigate,
}: {
  items: readonly NavItem[];
  variant: NavLinkVariant;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return items.map((item) => (
    <Link
      key={item.href}
      href={item.href}
      onNavigate={onNavigate}
      aria-current={isNavItemActive(item, pathname) ? "page" : undefined}
      className={navLinkVariants({ variant })}
    >
      {item.label}
    </Link>
  ));
}
