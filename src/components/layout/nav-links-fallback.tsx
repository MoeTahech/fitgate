import Link from "next/link";
import { navLinkVariants, type NavItem, type NavLinkVariant } from "./nav";

/** `NavLinks` without the active marker, for its Suspense fallback. */
export function NavLinksFallback({ items, variant }: { items: readonly NavItem[]; variant: NavLinkVariant }) {
  return items.map((item) => (
    <Link key={item.href} href={item.href} className={navLinkVariants({ variant })}>
      {item.label}
    </Link>
  ));
}
