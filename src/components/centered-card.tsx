import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

/** Page body that centers a single card (auth and invite pages). */
export function CenteredPage({ children }: { children: ReactNode }) {
  return <main className="flex flex-1 items-start justify-center px-4 py-12 sm:items-center">{children}</main>;
}

/** A single-task card whose title is the page's `<h1>`. */
export function CenteredCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="w-full max-w-sm">
      <Card size="lg">
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight text-card-foreground">{title}</h1>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        {children ? <CardContent>{children}</CardContent> : null}
      </Card>
      {footer ? <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  );
}
