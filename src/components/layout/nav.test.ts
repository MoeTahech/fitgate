import { describe, expect, it } from "vitest";
import { accountNavItem, ADMIN_NAV, isNavItemActive, MAIN_NAV, navItemsFor, type NavItem } from "./nav";

function active(items: readonly NavItem[], pathname: string): string[] {
  return items.filter((item) => isNavItemActive(item, pathname)).map((item) => item.label);
}

describe("isNavItemActive", () => {
  it("matches the path and its sub-paths, not a path that only shares the prefix", () => {
    const item: NavItem = { href: "/admin/members", label: "Members" };
    expect(isNavItemActive(item, "/admin/members")).toBe(true);
    expect(isNavItemActive(item, "/admin/members/abc")).toBe(true);
    expect(isNavItemActive(item, "/admin/memberships")).toBe(false);
  });

  it("uses `match` instead of `href` when set", () => {
    const item: NavItem = { href: "/admin/users", label: "Admin", match: "/admin" };
    expect(isNavItemActive(item, "/admin/payments")).toBe(true);
    expect(isNavItemActive(item, "/account")).toBe(false);
  });

  it("matches only the exact path when `exact` is set", () => {
    const item: NavItem = { href: "/account", label: "Account", exact: true };
    expect(isNavItemActive(item, "/account")).toBe(true);
    expect(isNavItemActive(item, "/account/membership")).toBe(false);
  });

  it("`exact` still honours `match`", () => {
    const item: NavItem = { href: "/a/start", label: "A", match: "/a", exact: true };
    expect(isNavItemActive(item, "/a")).toBe(true);
    expect(isNavItemActive(item, "/a/start")).toBe(false);
  });
});

describe("main nav", () => {
  const withAccount = [...MAIN_NAV, accountNavItem("Alex")];

  it("marks only Membership on /account/membership", () => {
    expect(active(withAccount, "/account/membership")).toEqual(["Membership"]);
  });

  it("marks only the account link on /account", () => {
    expect(active(withAccount, "/account")).toEqual(["Alex"]);
  });

  it("shows Membership to every role and Admin only to admins", () => {
    expect(navItemsFor(MAIN_NAV, "MEMBER").map((item) => item.label)).toEqual(["Membership"]);
    expect(navItemsFor(MAIN_NAV, "TRAINER").map((item) => item.label)).toEqual(["Membership"]);
    expect(navItemsFor(MAIN_NAV, "ADMIN").map((item) => item.label)).toEqual(["Membership", "Admin"]);
  });

  it("keeps the Admin link active across the admin sections", () => {
    for (const path of ["/admin/members", "/admin/memberships/abc", "/admin/payments", "/admin/trainers"]) {
      expect(active(MAIN_NAV, path)).toEqual(["Admin"]);
    }
  });

  it("builds the account link as exact", () => {
    expect(accountNavItem("Account")).toEqual({ href: "/account", label: "Account", exact: true });
  });
});

describe("admin nav", () => {
  it("lists the sections in order", () => {
    expect(ADMIN_NAV.map((item) => [item.label, item.href])).toEqual([
      ["Members", "/admin/members"],
      ["Memberships", "/admin/memberships"],
      ["Payments", "/admin/payments"],
      ["Users", "/admin/users"],
      ["Trainers", "/admin/trainers"],
    ]);
  });

  it("marks one section per page, and Members not on Memberships pages", () => {
    expect(active(ADMIN_NAV, "/admin/members")).toEqual(["Members"]);
    expect(active(ADMIN_NAV, "/admin/members/abc")).toEqual(["Members"]);
    expect(active(ADMIN_NAV, "/admin/memberships")).toEqual(["Memberships"]);
    expect(active(ADMIN_NAV, "/admin/memberships/abc")).toEqual(["Memberships"]);
    expect(active(ADMIN_NAV, "/admin/payments")).toEqual(["Payments"]);
    expect(active(ADMIN_NAV, "/admin/users")).toEqual(["Users"]);
  });
});
