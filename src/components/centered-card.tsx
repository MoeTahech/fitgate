import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { CardTitleHeading } from "./card-title-heading";

/** Page body that centers a single card (auth and invite pages). */
export function CenteredPage({ children }: { children: ReactNode }) {
  return <main className="flex flex-1 items-start justify-center px-4 py-12 sm:items-center">{children}</main>;
}

/**
 * A single-task card whose title is the page's `<h1>`. Pass `focusTitle` on a success view that
 * replaces a form, so focus moves to its heading when it appears.
 */
export function CenteredCard({
  title,
  description,
  children,
  footer,
  focusTitle = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  focusTitle?: boolean;
}) {
  return (
    <div className="w-full max-w-sm">
      <Card size="lg">
        <CardHeader>
          <CardTitleHeading focus={focusTitle}>{title}</CardTitleHeading>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        {children ? <CardContent>{children}</CardContent> : null}
      </Card>
      {footer ? <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  );
}
