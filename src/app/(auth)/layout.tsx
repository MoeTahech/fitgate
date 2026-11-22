export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <main className="flex flex-1 items-start justify-center px-4 py-12 sm:items-center">{children}</main>;
}
