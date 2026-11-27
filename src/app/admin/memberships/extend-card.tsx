import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDay } from "@/lib/memberships-ui/display";
import { formatMoney } from "@/lib/money";
import type { ExtensionPreview } from "@/lib/services/memberships/queries";
import { formatLocalTime } from "@/lib/time";
import { ExtendForm } from "./extend-form";

/** "Extend to {new end} for {price}", with the payment form. */
export function ExtendCard({
  membershipId,
  planName,
  extension,
  timeZone,
}: {
  membershipId: string;
  planName: string;
  extension: ExtensionPreview;
  timeZone: string;
}) {
  const newEnd = `${formatDay(extension.newEnd, timeZone)}, ${formatLocalTime(extension.newEnd, timeZone)}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={3} className="wrap-anywhere">
          Extend {planName}
        </CardTitle>
        <CardDescription>
          Extend to {newEnd} for {formatMoney(extension.priceCents, extension.currency)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ExtendForm membershipId={membershipId} />
      </CardContent>
    </Card>
  );
}
