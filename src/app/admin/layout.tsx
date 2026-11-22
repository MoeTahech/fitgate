import Link from "next/link";

const LINKS = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/trainers", label: "Trainers" },
] as const;

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <nav aria-label="Admin" className="mb-6 flex gap-4 border-b border-zinc-200 pb-3 text-sm dark:border-zinc-800">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">
            {link.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
