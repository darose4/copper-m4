// Orders and refunds, and the one rule that decides them: a refund at or under
// the auto-refund limit goes through; anything over it waits for a person in
// the Refund Console. The rule lives here, in plain code, so the model can
// never argue its way past it (no matter what a customer tells the chat).
//
// This is the only file that knows where orders and refunds are kept. They live
// in the server's memory, seeded from lib/copper/data/orders.json, so a fresh
// server (or "Reset demo data") starts clean. Swapping in a database later
// means changing only this file.
import data from "./data/orders.json";

export type Order = {
  id: string;
  customer: string;
  email: string;
  placedOn: string;
  items: string[];
  totalUsd: number;
};

export type RefundStatus = "pending" | "refunded" | "rejected";

export type Refund = {
  id: string;
  orderId: string;
  amountUsd: number;
  reason: string;
  status: RefundStatus;
  /** True when the code approved it (at or under the limit); false when a person decided. */
  auto: boolean;
  requestedAt: string;
  decidedAt: string | null;
};

export type OrderWithRefund = Order & { refund: Refund | null };

export type RequestRefundResult =
  | { status: "not_found"; orderId: string }
  | { status: "already_requested"; refund: Refund }
  | { status: "refunded"; refund: Refund; limitUsd: number }
  | { status: "pending_approval"; refund: Refund; limitUsd: number };

export const DEFAULT_LIMIT_USD = 50;
export const MAX_LIMIT_USD = 10_000;

type State = { limitUsd: number; refunds: Refund[]; counter: number };

const globalStore = globalThis as unknown as { __copperRefunds?: State };

function state(): State {
  return (globalStore.__copperRefunds ??= {
    limitUsd: DEFAULT_LIMIT_USD,
    refunds: [],
    counter: 0,
  });
}

const cents = (usd: number) => Math.round(usd * 100) / 100;
const normalize = (text: string) => text.trim().toLowerCase();

const orders = (): Order[] => structuredClone(data.orders);

function refundFor(orderId: string): Refund | null {
  const found = state().refunds.find((r) => r.orderId === orderId);
  return found ? { ...found } : null;
}

/** Every order, each with its refund (if one was ever asked for). */
export function allOrders(): OrderWithRefund[] {
  return orders().map((order) => ({ ...order, refund: refundFor(order.id) }));
}

/** A customer's orders, found by email and/or order number. Needs at least one. */
export function findOrders(filter: {
  email?: string;
  orderId?: string;
}): OrderWithRefund[] {
  const email = filter.email ? normalize(filter.email) : "";
  const orderId = filter.orderId ? normalize(filter.orderId) : "";
  if (!email && !orderId) return [];
  return allOrders().filter(
    (order) =>
      (!email || normalize(order.email) === email) &&
      (!orderId || normalize(order.id) === orderId),
  );
}

export function getLimit(): number {
  return state().limitUsd;
}

/** Sets the auto-refund limit. Returns false for anything that isn't 0 to MAX_LIMIT_USD dollars. */
export function setLimit(limitUsd: number): boolean {
  if (
    typeof limitUsd !== "number" ||
    !Number.isFinite(limitUsd) ||
    limitUsd < 0 ||
    limitUsd > MAX_LIMIT_USD
  )
    return false;
  state().limitUsd = cents(limitUsd);
  return true;
}

/**
 * Asks for a refund of a whole order. At or under the limit it is refunded on
 * the spot; over it, it waits for a person. An order can only be asked about
 * once: a second request (even after a rejection) gets the first one back.
 */
export function requestRefund(input: {
  orderId: string;
  reason: string;
}): RequestRefundResult {
  const order = orders().find(
    (o) => normalize(o.id) === normalize(input.orderId),
  );
  if (!order) return { status: "not_found", orderId: input.orderId.trim() };
  const existing = refundFor(order.id);
  if (existing) return { status: "already_requested", refund: existing };

  const s = state();
  const now = new Date().toISOString();
  const auto = order.totalUsd <= s.limitUsd;
  const refund: Refund = {
    id: `RF-${String(++s.counter).padStart(3, "0")}`,
    orderId: order.id,
    amountUsd: cents(order.totalUsd),
    reason: input.reason.trim(),
    status: auto ? "refunded" : "pending",
    auto,
    requestedAt: now,
    decidedAt: auto ? now : null,
  };
  s.refunds.push(refund);
  return {
    status: auto ? "refunded" : "pending_approval",
    refund: { ...refund },
    limitUsd: s.limitUsd,
  };
}

/** A person's decision on a refund that is waiting. Returns null if it isn't waiting. */
export function decideRefund(
  refundId: string,
  decision: "approve" | "reject",
): Refund | null {
  const refund = state().refunds.find((r) => r.id === refundId);
  if (!refund || refund.status !== "pending") return null;
  refund.status = decision === "approve" ? "refunded" : "rejected";
  refund.decidedAt = new Date().toISOString();
  return { ...refund };
}

/** Back to the starting orders, no refunds, and the default limit. */
export function resetRefunds(): void {
  globalStore.__copperRefunds = undefined;
}

export type ConsoleSnapshot = {
  limitUsd: number;
  orders: OrderWithRefund[];
};

/** Everything the Refund Console shows. */
export function consoleSnapshot(): ConsoleSnapshot {
  return { limitUsd: getLimit(), orders: allOrders() };
}
