import { CenteredPage } from "@/components/centered-card";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <CenteredPage>{children}</CenteredPage>;
}
