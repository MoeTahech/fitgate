# Plan: UI foundation

Branch `feat/ui-foundation`, from `main` at `beaf37e` (PR A merged). Step 1 saves this plan as
`docs/plans/ui-foundation.md`.

## Context

Spec milestone 2a.2 and `docs/plans/memberships.md` (lines 402-407) put a UI foundation PR
between the memberships backend (PR A, merged) and the memberships pages (PR B). Today the UI is
copy-pasted Tailwind strings: zinc palette, `dark:` utilities driven by `prefers-color-scheme`,
three button heights, two card styles, an `<ul>` instead of tables, inline status text instead
of alerts. The only shared file is `src/components/ui/form.tsx` (`Field`, `SubmitButton`,
`FormAlert`, `AuthCard`). Geist is loaded but `body { font-family: Arial }` overrides it. The
admin trainers page and `trainerInviteEmail` build their own `Intl.DateTimeFormat`.

Outcome: brand tokens (black, orange, white) that pass WCAG AA, shadcn/ui primitives on Base UI,
a small set of app components, a mobile-first layout (dark header, admin sidebar, mobile menu),
all existing pages migrated, and a `CLAUDE.md` rule that PR B and later pages build only from
these components. No new business logic; all existing tests stay green.

## Decisions

| # | Decision |
|---|---|
| 1 | **shadcn/ui on Base UI** (`base-nova` style, shadcn's default since July 2026). Components are copied into `src/components/ui/` and edited to our tokens. |
| 2 | **No `shadcn` package installed.** The CLI runs as `npx shadcn@4.23.0` (as we do with `npx auth@1.7.27`). The rules `init` would import from `shadcn/tailwind.css` are copied into `globals.css`. |
| 3 | **Native select** (shadcn `native-select`): posts with FormData, uses the phone's own picker, works before JS loads. No custom popup Select. |
| 4 | **Tokens in hex**, defined as CSS variables in `:root` (light) and `.dark`, mapped into Tailwind with `@theme inline`. Dark mode uses `@custom-variant dark (&:where(.dark, .dark *))`. Nothing sets `.dark`, so only light ships (no toggle, no `prefers-color-scheme`). |
| 5 | **Brand orange appears only as** primary action background, link text, focus ring and the active nav indicator. Status colors are separate semantic tokens (Decision 7), never orange. shadcn's `accent` token keeps its shadcn meaning (neutral hover surface), not brand. |
| 6 | **Primary button: near-black text on bright orange** (7.06:1). White text on orange-500/600 fails (2.80 / 3.56), so white-on-orange is not used. |
| 7 | **Status tones:** active (green), frozen (blue), past due (red), expired (gray), cancelled (violet), pending (yellow). Every badge shows a text label, so color is never the only signal. Enum-to-tone/label maps live with the badge, typed `Record<Enum, …>` so new enum values fail the type check. |
| 8 | **Layout:** near-black header (wordmark, top-level links, account link); admin sidebar from `md` up; below `md`, a hamburger opens a Sheet holding the top-level links, the admin sections (admins only) and Sign out. One nav config, filtered by role. |
| 9 | **Guardrails as tests (no new deps):** a contrast test reads the tokens from `globals.css` and checks every pair below; a style test fails on raw palette classes (`zinc-`, `red-`, `emerald-`, …) or `dark:` under `src/app` and `src/components` (excluding `src/components/ui`). |
| 10 | **Dates:** every displayed date goes through `formatLocal` / `formatLocalTime` (`src/lib/time.ts`); no new helpers are needed. |

## Dependencies (ask-before-install list)

Exact versions, like the rest of `package.json`:

- dependencies: `@base-ui/react@1.9.0` (headless primitives), `class-variance-authority@0.7.1`
  (variants; brings `clsx` transitively), `cn@0.5.2` (class merging; replaces clsx +
  tailwind-merge; needs Node >= 22, we run 24), `lucide-react@1.80.0` (icons: menu, close,
  alerts, empty states).
- devDependencies: `tw-animate-css@1.4.0` (enter/exit animations used by Dialog and Sheet).
- Not added: `shadcn`, `sonner`, `next-themes`, `react-hook-form`, testing-library, jsdom.

`cn` check (2026-11-25): shadcn 4.23.0's registry uses it by default. `base-nova/utils.json` is
`export { cn } from "cn"`, every component item declares `"dependencies": ["cn"]`, and the CLI's
own manifest depends on `cn`. npm: 25.7M weekly downloads (tailwind-merge 116M, clsx 176M), MIT,
zero dependencies, maintainer `shadcn`, repo `github.com/shadcn-ui/cn` (shadcn-ui org, ~1.8k
stars, maintained by shadcn and Aiden Bai). Caveat: the npm name is old; 0.1.x was an unrelated
package by another author, and shadcn's code starts at 0.2.0. We pin 0.5.2 exactly. Fallback, if
it misbehaves: `clsx` + `tailwind-merge` v3 behind the same `cn` export in `src/lib/utils.ts`.

## Palette and contrast (WCAG 2.x ratios)

Light (shipped):

| Token pair | Colors | Ratio | Needs |
|---|---|---|---|
| foreground on background / card | `#0A0A0A` on `#FFFFFF` | 19.80 | 4.5 |
| secondary-foreground on secondary | `#0A0A0A` on `#F5F5F5` | 18.16 | 4.5 |
| muted-foreground on background / muted | `#525252` on `#FFFFFF` / `#F5F5F5` | 7.81 / 7.17 | 4.5 |
| primary-foreground on primary | `#0A0A0A` on `#F97316` | 7.06 | 4.5 |
| primary-foreground on primary-hover | `#0A0A0A` on `#EA580C` | 5.56 | 4.5 |
| link on background / muted | `#C2410C` on `#FFFFFF` / `#F5F5F5` | 5.18 / 4.75 | 4.5 |
| link-hover on background | `#9A3412` on `#FFFFFF` | 7.31 | 4.5 |
| ring vs background / header | `#EA580C` vs `#FFFFFF` / `#0A0A0A` | 3.56 / 5.56 | 3.0 (non-text) |
| input border vs background | `#737373` vs `#FFFFFF` | 4.74 | 3.0 (non-text) |
| destructive-foreground on destructive | `#FFFFFF` on `#B91C1C` | 6.47 | 4.5 |
| destructive on destructive-subtle | `#B91C1C` on `#FEF2F2` | 5.91 | 4.5 |
| success on success-subtle | `#166534` on `#F0FDF4` | 6.81 | 4.5 |
| warning on warning-subtle | `#854D0E` on `#FEFCE8` | 6.62 | 4.5 |
| info on info-subtle | `#1E40AF` on `#EFF6FF` | 8.01 | 4.5 |
| header-foreground on header | `#FFFFFF` on `#0A0A0A` | 19.80 | 4.5 |
| header-muted on header | `#A3A3A3` on `#0A0A0A` | 7.85 | 4.5 |
| header-active on header | `#FB923C` on `#0A0A0A` | 8.75 | 4.5 |
| status active | `#166534` on `#DCFCE7` | 6.49 | 4.5 |
| status frozen | `#075985` on `#E0F2FE` | 6.59 | 4.5 |
| status past due | `#991B1B` on `#FEE2E2` | 6.80 | 4.5 |
| status expired | `#404040` on `#F5F5F5` | 9.51 | 4.5 |
| status cancelled | `#5B21B6` on `#EDE9FE` | 7.57 | 4.5 |
| status pending | `#854D0E` on `#FEF9C3` | 6.38 | 4.5 |

`border` (`#E5E5E5`) is decorative only (cards, table rows). The orange button against white is
2.80:1, which is acceptable because its text label identifies it (WCAG 1.4.11).

Dark (defined, not shipped): background `#0A0A0A` / foreground `#FAFAFA` 18.97; card `#171717`
17.18; muted-foreground `#A3A3A3` on card 7.11; primary `#FB923C` with `#0A0A0A` text 8.75; link
`#FB923C` 8.75 (7.92 on card); ring `#F97316` 7.06; input `#8A8A8A` vs card 5.19; destructive
`#F87171` with `#0A0A0A` text 7.16; status/feedback on dark tints: active `#86EFAC`/`#052E16` 10.62,
frozen `#7DD3FC`/`#082F49` 8.32, past due `#FCA5A5`/`#450A0A` 8.51, expired `#D4D4D4`/`#262626`
10.21, cancelled `#C4B5FD`/`#2E1065` 8.25, pending `#FDE047`/`#422006` 11.06, info
`#93C5FD`/`#172554` 8.15.

## 1. Setup: `components.json`, `src/lib/utils.ts`, `src/app/globals.css`

- Before writing code, read the bundled docs already identified: `01-getting-started/11-css.md`,
  `03-api-reference/02-components/font.md`, `03-api-reference/03-file-conventions/layout.md`
  (active nav links), `03-api-reference/04-functions/use-pathname.md` (Cache Components),
  `02-guides/preserving-ui-state.md`, `03-api-reference/04-functions/generate-viewport.md`.
- `components.json` written by hand: style `base-nova`, `rsc: true`, `tsx: true`,
  `tailwind.css: src/app/globals.css`, `tailwind.config: ""`, `cssVariables: true`,
  `iconLibrary: lucide`, aliases `@/components`, `@/components/ui`, `@/lib/utils`, `@/lib`,
  `@/hooks`. Then `npx shadcn@4.23.0 add …` per item. If `add` insists on `init`, run init and
  revert what it adds beyond the above (the `shadcn` devDependency, the `shadcn/tailwind.css`
  import, any `postcss.config.*`; Tailwind runs through the existing turbopack rule).
- `src/lib/utils.ts`: `export { cn } from "cn"`.
- `globals.css`: `@import "tailwindcss"`, `@import "tw-animate-css"`, the vendored rules from
  `shadcn/tailwind.css` (custom variants / utilities the components use; copied from the 4.23.0
  package with a one-line source comment), the dark custom variant, `:root` and `.dark` tokens,
  `@theme inline` mapping (`--color-*`, `--radius-*`, `--font-sans: var(--font-geist-sans)`,
  `--font-mono`), and `@layer base` (`* { border-border outline-ring/50 }`,
  `body { bg-background text-foreground font-sans }`). The Arial rule and the
  `prefers-color-scheme` block go.
- Root layout: `<body>` gets `isolate` (Base UI popup stacking), drops `bg-zinc-50 dark:bg-black`;
  static `viewport = { themeColor: "#0A0A0A" }`.

## 2. Primitives: `src/components/ui/`

Added via the CLI, then adjusted to the tokens. Generated files may use any utility; app code may not (Decision 9).

- `button` (`buttonVariants`): `default` (primary orange), `secondary`, `outline`, `ghost`,
  `destructive`, `link`; sizes `sm` / `default` (h-10) / `lg` (h-11, auth and mobile) / `icon`.
  Links styled as buttons use `buttonVariants()` on `next/link`.
- `input`, `label`, `field` (+ `separator`), `native-select`, `card`, `badge` (adds the six
  `status-*` variants), `table` (keeps its `overflow-x-auto` wrapper), `alert` (variants
  `info`, `success`, `warning`, `destructive`), `empty`, `alert-dialog`, `sheet`, `skeleton`.

## 3. App components: `src/components/`

- `form-field.tsx`: `FormField` composes `Field`/`FieldLabel`/`FieldDescription`/`FieldError`
  and passes `{ id, aria-invalid, aria-describedby }` to its control (render prop), keeping
  today's `${id}-error` / `${id}-hint` wiring and hiding the hint while an error shows.
  `InputField` and `SelectField` wrap it with the same props as today's `Field`.
- `submit-button.tsx`: `SubmitButton` (Button, `type="submit"`, `pending` → disabled +
  `aria-busy`), same API as today.
- `form-alert.tsx`: `FormAlert({ tone })` over `Alert`; `role="alert"` for errors, `status`
  otherwise (today's behavior).
- `inline-status.tsx`: `InlineStatus({ tone: "error" | "success" })`, a short result line next
  to a row action in a table or list (where a full `FormAlert` is too bulky); `role="alert"`
  for errors, `status` otherwise. Added in step 9.
- `text-link.tsx`: `TextLink` (next/link, `text-link underline hover:text-link-hover`).
- `pagination.tsx`: `Pagination({ page, pageCount, hrefFor })`, Previous/Next links (outline
  buttons) around "Page X of Y"; renders nothing for a single page. Server component, so
  `hrefFor` stays a plain function. Added in step 9 for admin users; PR B's lists reuse it.
- `page-header.tsx`: `PageHeader({ title, description?, actions? })`, the page's only `<h1>`.
- `empty-state.tsx`: `EmptyState({ title, description?, action?, icon? })` over `Empty`.
- `status-badge.tsx`: `StatusBadge({ tone, children })`, plus `MembershipStatusBadge`
  (ACTIVE, PAST_DUE "Past due", FROZEN, CANCELLED, EXPIRED) and `InviteStatusBadge` (PENDING →
  pending, ACCEPTED → active, REVOKED → cancelled, EXPIRED → expired). Freeze and payment maps
  come with PR B, which first displays them.
- `confirm-dialog.tsx` (client): `ConfirmDialog({ trigger, title, description, confirmLabel,
  tone, action, fields?, pending? })` over `AlertDialog`; the confirm button submits a `<form>`
  bound to the server action, so it works with `useActionState`.
- `centered-card.tsx`: replaces `AuthCard` (same props) for auth and invite pages, plus the
  centered `<main>` both use today.
- `page-container.tsx`: width + padding for standard pages (`max-w-5xl`, `max-w-2xl` narrow).
- `src/components/ui/form.tsx` is deleted once nothing imports it.

## 4. Layout: `src/components/layout/`

- `nav.ts`: `NAV_ITEMS` (top-level, with role) and `ADMIN_NAV_ITEMS` (Users, Trainers; PR B adds
  Members, Memberships, Payments).
- `nav-link.tsx` (client): `usePathname` active state (`aria-current="page"`, orange
  indicator). Every render site wraps it in `<Suspense>` with a non-active fallback, because
  `usePathname` suspends under dynamic params (`/invite/.../[token]`, PR B's `[userId]`).
- `site-header.tsx` (server): near-black bar, wordmark, desktop links, account link; signed out:
  Sign in + Join (primary). The user-dependent part stays behind `<Suspense>` with
  `getCurrentUser()` (display only), as today.
- `mobile-nav.tsx` (client): hamburger (`aria-label`, `aria-expanded`) opening a `Sheet` with
  the role-filtered links and `SignOutButton`. Closes on link click and on pathname change, and
  resets in a `useLayoutEffect` cleanup (Activity keeps hidden routes mounted).
- `admin-nav.tsx` + `src/app/admin/layout.tsx`: sidebar from `md` up; on small screens the
  admin sections live in the mobile menu.
- `sign-out-button.tsx` gets a `variant` prop instead of a caller `className`.

## 5. Page migration

Pattern for every page: `PageHeader` or `CenteredCard` for the heading, `FormField`/`InputField`/
`SelectField` and `SubmitButton` for forms, `FormAlert` for form-level messages (replacing inline
red/green status text), `InlineStatus` for row-action results, `Card` for panels, `Table` for
lists, `Pagination` for paged lists, `EmptyState` for empty lists,
`Skeleton` for Suspense fallbacks, `TextLink` and `buttonVariants` for links. No logic, action,
validation or copy changes beyond labels from the status maps.

- Auth (`src/app/(auth)/*`: sign-in, sign-up, forgot/reset password, verify email, resend
  verification, auth layout).
- Account (`src/app/account/page.tsx`): Card with the `dl`; one shared `ROLE_LABELS` (today
  duplicated in `account/page.tsx` and `admin/users/role-form.tsx`) moves to
  `src/lib/auth/constants.ts`.
- Invite accept: `src/app/invite/trainer/[token]/*`, `src/app/invite/membership/[token]/*`.
- Admin trainers (`src/app/admin/trainers/*`): Table, `InviteStatusBadge`, `EmptyState`,
  `formatLocal(…, timeZone)` instead of the page's `Intl.DateTimeFormat`, Revoke behind
  `ConfirmDialog`, Resend/Revoke results via `InlineStatus`.
- Also migrated so the new rule holds everywhere: admin users (`src/app/admin/users/*`: search,
  Table, role `NativeSelect` with an `aria-label` (inline in the row, no visible label),
  `InlineStatus` for the save result, `Pagination`) and the landing page (`src/app/page.tsx`).
- `src/lib/email/templates.ts` `trainerInviteEmail` uses `formatLocal(…, { dateStyle: "long",
  timeStyle: "short" })` like `membershipInviteEmail` (same output; existing test stays green).

## 6. `CLAUDE.md`

- Stack: shadcn/ui on Base UI, CLI via `npx shadcn@4.23.0` (not installed), `cn` from
  `@/lib/utils`, `tw-animate-css`, `lucide-react`.
- Architecture: `src/components/ui/` (generated primitives), `src/components/` (app components),
  `src/components/layout/` (header, nav); tokens in `globals.css` (light shipped, `.dark`
  defined, no toggle).
- Rule: pages and feature components build only from these components and tokens: no raw
  palette classes, no `dark:` utilities, no one-off component styling (layout utilities like
  grid, gap, margin are fine). A missing pattern becomes a shared component first. Displayed
  dates via `formatLocal`/`formatLocalTime`. New statuses get a typed map in `status-badge.tsx`.
  Enforced by `tests/ui/`.
- Commands: how to add a primitive (`npx shadcn@4.23.0 add <item>`, then adjust to tokens).

## 7. Tests

- `tests/ui/theme-contrast.test.ts`: parses `:root` and `.dark` from `globals.css`, computes WCAG
  ratios, asserts every pair in the tables above (4.5 text, 3.0 ring/input).
- `tests/ui/no-raw-styles.test.ts`: scans `src/app/**/*.tsx` and `src/components/**/*.tsx`
  (excluding `src/components/ui/`) for raw Tailwind palette colors and `dark:`.
- Existing suites unchanged and green. No component render tests (would need jsdom +
  testing-library; not in scope).

## Implementation steps (one small commit each)

1. `docs: add UI foundation plan`: this file as `docs/plans/ui-foundation.md`.
2. `chore: add shadcn/ui setup`: install the deps above, `components.json`, `src/lib/utils.ts`,
   vendored CSS; `CLAUDE.md` stack lines.
3. `feat: add design tokens`: `globals.css` tokens, fonts fix, root layout `isolate` and
   viewport; `tests/ui/theme-contrast.test.ts`.
4. `feat: add UI primitives`: `src/components/ui/*` adjusted to tokens.
5. `feat: add shared app components`: section 3; `CLAUDE.md` component rule.
6. `feat: add app layout with mobile menu`: section 4; `CLAUDE.md` layout lines.
7. `refactor: migrate auth pages to shared components`.

   **Checkpoint:** stop here. Ask the user to run the app at 375 px and 1280 px (header, mobile
   menu, auth pages) and wait for their OK or token changes before step 8. Token changes update
   `globals.css` and the contrast tables in this plan, and must keep the contrast test green.
8. `refactor: migrate account and invite pages to shared components`.
9. `refactor: migrate admin pages to shared components`: trainers, users, landing; delete
   `src/components/ui/form.tsx`.
10. `refactor: format trainer invite email expiry with formatLocal`.
11. `test: forbid raw palette classes outside UI primitives`: `tests/ui/no-raw-styles.test.ts`
    (passes once migration is complete); `CLAUDE.md` enforcement note; spec milestone 2a.2
    marked done.

Each step: `npx tsc --noEmit`, `npm run lint`; `npm test` from step 3 on (`/verify` before each
commit).

## Verification

- `/verify` (tsc, lint, tests, all green) and `npm run build` (catches missing Suspense
  boundaries around `usePathname` and session reads under `cacheComponents`).
- Manual: `docker compose up -d`, `npm run dev`; at 375 px and 1280 px widths check sign-up →
  verify (Mailpit) → sign-in → account → sign-out; admin: users (search, role change),
  trainers (create, resend, revoke with confirm dialog), sign-up through a trainer invite link
  and a membership invite link (signed out, wrong account, accept). Check the mobile menu opens,
  closes on navigation, traps focus and closes on Escape; keyboard focus ring is visible on
  every control; status badges read correctly.
- `git grep` for `Intl.DateTimeFormat` outside `src/lib/time.ts` returns nothing.

## Not in this PR

Dark mode toggle, toasts, custom popup Select, component render tests, brand/logo/landing page
(milestone 6), any membership pages (PR B).
