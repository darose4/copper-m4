"use server";

// What the Refund Console can do. Each action checks its input on the server,
// because anyone can call a Server Action, not just the buttons on the page.
import {
  type ConsoleSnapshot,
  consoleSnapshot,
  decideRefund,
  MAX_LIMIT_USD,
  type Refund,
  resetRefunds,
  setLimit,
} from "@/lib/copper/refunds";

export async function getConsole(): Promise<ConsoleSnapshot> {
  return consoleSnapshot();
}

export async function saveLimit(
  limitUsd: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!setLimit(Number(limitUsd)))
    return {
      ok: false,
      message: `Enter an amount from $0 to $${MAX_LIMIT_USD.toLocaleString("en-US")}.`,
    };
  return { ok: true };
}

export async function decide(
  refundId: string,
  decision: "approve" | "reject",
): Promise<{ ok: true; refund: Refund } | { ok: false; message: string }> {
  if (decision !== "approve" && decision !== "reject")
    return { ok: false, message: "Choose Approve or Reject." };
  const refund = decideRefund(String(refundId), decision);
  if (!refund)
    return { ok: false, message: "That refund isn't waiting for a decision." };
  return { ok: true, refund };
}

export async function resetDemo(): Promise<void> {
  resetRefunds();
}
