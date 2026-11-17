"use client";

// The Refund Console: the human side of refunds. A person sets the auto-refund
// limit and decides every refund over it. The Refund agent in the chat does
// the talking; the rule that sorts refunds is code (lib/copper/refunds.ts).
import { CheckIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  decide,
  getConsole,
  resetDemo,
  saveLimit,
} from "@/app/support/actions";
import { REFUND_DECIDED_EVENT } from "@/components/copper/ask-copper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUsd } from "@/lib/copper/catalog";
import type { ConsoleSnapshot, OrderWithRefund } from "@/lib/copper/refunds";

/** How often the console checks for new refunds waiting for a decision. */
const REFRESH_MS = 3000;

/** What the Refund agent tells the customer once a person has decided. */
function decisionNotice(
  decision: "approve" | "reject",
  orderId: string,
  amountUsd: number,
): string {
  return decision === "approve"
    ? `Good news: a team member approved your refund of ${formatUsd(amountUsd)} for order ${orderId}. It's on its way back to you.`
    : `A team member reviewed your refund request for order ${orderId} and couldn't approve it this time. If you'd like to talk it over, contact the Copper Crew in the Copper app (Settings > Help).`;
}

function statusOf(order: OrderWithRefund): {
  label: string;
  variant: "outline" | "default" | "secondary" | "destructive";
} {
  const refund = order.refund;
  if (!refund) return { label: "No refund", variant: "outline" };
  if (refund.status === "pending")
    return { label: "Waiting for you", variant: "secondary" };
  if (refund.status === "rejected")
    return { label: "Rejected", variant: "destructive" };
  return {
    label: refund.auto ? "Refunded automatically" : "Refunded (approved)",
    variant: "default",
  };
}

export function RefundConsole() {
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(null);
  const [limitDraft, setLimitDraft] = useState<string | null>(null);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await getConsole());
    } catch {
      setError("Couldn't load refunds. Trying again…");
    }
  }, []);

  // Load now, then keep checking: a refund over the limit shows up here on its own.
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  // The box shows the server's limit until someone types in it.
  const limit = limitDraft ?? (snapshot ? String(snapshot.limitUsd) : "");

  async function onSaveLimit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    const amount = limit.trim() === "" ? Number.NaN : Number(limit);
    const result = Number.isFinite(amount)
      ? await saveLimit(amount)
      : { ok: false as const, message: "Enter an amount, like 50." };
    if (!result.ok) {
      setLimitMessage(result.message);
      return;
    }
    setLimitMessage(null);
    setSaved(true);
    setLimitDraft(null);
    await refresh();
  }

  async function onDecide(
    order: OrderWithRefund,
    decision: "approve" | "reject",
  ) {
    const refund = order.refund;
    if (!refund) return;
    setBusyId(refund.id);
    setError(null);
    const result = await decide(refund.id, decision);
    setBusyId(null);
    if (!result.ok) setError(result.message);
    else
      window.dispatchEvent(
        new CustomEvent(REFUND_DECIDED_EVENT, {
          detail: {
            text: decisionNotice(decision, order.id, refund.amountUsd),
          },
        }),
      );
    await refresh();
  }

  async function onReset() {
    await resetDemo();
    setSaved(false);
    setLimitMessage(null);
    setLimitDraft(null);
    await refresh();
  }

  const orders = snapshot?.orders ?? [];
  const waiting = orders.filter((o) => o.refund?.status === "pending");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Auto-refund limit</CardTitle>
          <CardDescription>
            Refunds at or under this amount go through on their own. Anything
            over it waits here for you. Set it to $0 and every refund waits.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={onSaveLimit}
            noValidate
            className="flex flex-wrap items-end gap-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="refund-limit">Limit (USD)</Label>
              <div className="flex items-center gap-1.5">
                <span aria-hidden className="text-muted-foreground">
                  $
                </span>
                <Input
                  id="refund-limit"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={limit}
                  onChange={(event) => {
                    setLimitDraft(event.target.value);
                    setSaved(false);
                  }}
                  className="w-32"
                />
              </div>
            </div>
            <Button type="submit">Save limit</Button>
            <p
              role="status"
              className="text-muted-foreground min-h-5 text-sm"
              data-testid="limit-status"
            >
              {limitMessage ? (
                <span className="text-destructive">{limitMessage}</span>
              ) : saved ? (
                `Saved. The limit is now ${formatUsd(Number(limit))}.`
              ) : snapshot ? (
                `Current limit: ${formatUsd(snapshot.limitUsd)}`
              ) : null}
            </p>
          </form>
        </CardContent>
      </Card>

      <Card data-testid="needs-decision">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Needs your decision
            {waiting.length > 0 && <Badge>{waiting.length}</Badge>}
          </CardTitle>
          <CardDescription>
            Refunds over the limit. Nothing is paid until you approve.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {waiting.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing is waiting. When the Refund agent gets a request over the
              limit, it shows up here.
            </p>
          ) : (
            <ul className="divide-y">
              {waiting.map((order) => (
                <li
                  key={order.id}
                  data-testid="pending-refund"
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 space-y-0.5 text-sm">
                    <p className="font-semibold">
                      {order.id}{" "}
                      <span className="text-primary font-mono">
                        {formatUsd(order.refund!.amountUsd)}
                      </span>
                    </p>
                    <p className="text-muted-foreground">
                      {order.customer} · {order.items.join(", ")}
                    </p>
                    <p className="text-muted-foreground italic">
                      “{order.refund!.reason}”
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busyId === order.refund!.id}
                      onClick={() => onDecide(order, "approve")}
                      aria-label={`Approve refund for ${order.id}`}
                    >
                      <CheckIcon /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === order.refund!.id}
                      onClick={() => onDecide(order, "reject")}
                      aria-label={`Reject refund for ${order.id}`}
                    >
                      <XIcon /> Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="text-destructive mt-3 text-sm">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Orders to refund</CardTitle>
          <CardDescription>
            What customers can ask the Refund agent about. Try the email
            addresses or order numbers below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table data-testid="orders">
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="hidden sm:table-cell">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Refund</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => {
                const status = statusOf(order);
                return (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono font-medium">
                      {order.id}
                    </TableCell>
                    <TableCell>
                      <span className="block">{order.customer}</span>
                      <span className="text-muted-foreground block text-xs">
                        {order.email}
                      </span>
                    </TableCell>
                    <TableCell className="hidden whitespace-normal sm:table-cell">
                      {order.items.join(", ")}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatUsd(order.totalUsd)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!snapshot && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-muted-foreground text-center"
                  >
                    Loading orders…
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset demo data
        </Button>
      </div>
    </div>
  );
}
