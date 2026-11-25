import { cva } from "class-variance-authority";
import type { AppRole } from "@/lib/auth/constants";

export type NavItem = {
  href: string;
  label: string;
  /** Path prefix that marks the link active; defaults to `href`. */
  match?: string;
  /** Roles that see the link; all signed-in users when omitted. */
  roles?: readonly AppRole[];
};

export const MAIN_NAV: readonly NavItem[] = [{ href: "/admin/users", label: "Admin", match: "/admin", roles: ["ADMIN"] }];

export const ADMIN_NAV: readonly NavItem[] = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/trainers", label: "Trainers" },
];

export const ACCOUNT_HREF = "/account";

export function navItemsFor(items: readonly NavItem[], role: AppRole): NavItem[] {
  return items.filter((item) => !item.roles || item.roles.includes(role));
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const base = item.match ?? item.href;
  return pathname === base || pathname.startsWith(`${base}/`);
}

export const navLinkVariants = cva("flex items-center font-medium transition-colors", {
  variants: {
    variant: {
      header:
        "relative h-9 rounded-md px-3 text-sm text-header-muted hover:text-header-foreground aria-[current=page]:text-header-foreground aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3 aria-[current=page]:after:-bottom-2.5 aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-header-active",
      sidebar:
        "h-9 rounded-md border-l-2 border-transparent px-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-[current=page]:border-primary aria-[current=page]:bg-accent aria-[current=page]:text-foreground",
      sheet:
        "h-11 rounded-md border-l-2 border-transparent px-3 text-base text-foreground hover:bg-accent aria-[current=page]:border-primary aria-[current=page]:bg-accent",
    },
  },
});

export type NavLinkVariant = NonNullable<Parameters<typeof navLinkVariants>[0]>["variant"];
