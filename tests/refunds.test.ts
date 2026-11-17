// The refund rule: at or under the auto-refund limit a refund goes through;
// over it, it waits for a person. It is plain code, so nothing a customer says
// to the chat can change the outcome.
import { beforeEach, describe, expect, it } from "vitest";
import {
  allOrders,
  decideRefund,
  DEFAULT_LIMIT_USD,
  findOrders,
  getLimit,
  requestRefund,
  resetRefunds,
  setLimit,
} from "@/lib/copper/refunds";

beforeEach(() => resetRefunds());

describe("orders", () => {
  it("has orders both under and over the default $50 limit", () => {
    const totals = allOrders().map((o) => o.totalUsd);
    expect(totals.some((t) => t <= DEFAULT_LIMIT_USD)).toBe(true);
    expect(totals.some((t) => t > DEFAULT_LIMIT_USD)).toBe(true);
    expect(allOrders().every((o) => o.refund === null)).toBe(true);
  });

  it("finds orders by email or order number, ignoring case, and needs one of them", () => {
    expect(findOrders({})).toEqual([]);
    expect(findOrders({ email: "  DANA.REYES@example.com " })).toHaveLength(2);
    expect(findOrders({ orderId: "csl-1003" }).map((o) => o.id)).toEqual([
      "CSL-1003",
    ]);
    // Both must match: Dana's email does not open Marcus's order.
    expect(
      findOrders({ email: "dana.reyes@example.com", orderId: "CSL-1003" }),
    ).toEqual([]);
  });
});

describe("requestRefund", () => {
  it("refunds on the spot when the order is at or under the limit", () => {
    const result = requestRefund({ orderId: "CSL-1001", reason: "Changed my mind" });
    expect(result).toMatchObject({
      status: "refunded",
      limitUsd: 50,
      refund: { orderId: "CSL-1001", amountUsd: 7.99, auto: true },
    });
    expect(findOrders({ orderId: "CSL-1001" })[0].refund?.status).toBe("refunded");
  });

  it("makes an order over the limit wait for a person", () => {
    const result = requestRefund({ orderId: "CSL-1003", reason: "Too big for my desk" });
    expect(result).toMatchObject({
      status: "pending_approval",
      refund: { status: "pending", auto: false, decidedAt: null },
    });
  });

  it("treats exactly the limit as under it", () => {
    setLimit(79);
    expect(requestRefund({ orderId: "CSL-1002", reason: "x y z" }).status).toBe(
      "refunded",
    );
  });

  it("with the limit at $0, every refund waits for a person", () => {
    expect(setLimit(0)).toBe(true);
    expect(requestRefund({ orderId: "CSL-1001", reason: "x y z" }).status).toBe(
      "pending_approval",
    );
  });

  it("only lets an order be asked about once, even after a rejection", () => {
    const first = requestRefund({ orderId: "CSL-1003", reason: "first" });
    expect(first.status).toBe("pending_approval");
    expect(requestRefund({ orderId: "CSL-1003", reason: "again" }).status).toBe(
      "already_requested",
    );
    const id = first.status === "pending_approval" ? first.refund.id : "";
    decideRefund(id, "reject");
    const again = requestRefund({ orderId: "csl-1003", reason: "please?" });
    expect(again).toMatchObject({
      status: "already_requested",
      refund: { status: "rejected" },
    });
    expect(allOrders().filter((o) => o.refund)).toHaveLength(1);
  });

  it("says when the order doesn't exist", () => {
    expect(requestRefund({ orderId: "CSL-9999", reason: "x y z" })).toEqual({
      status: "not_found",
      orderId: "CSL-9999",
    });
  });
});

describe("a person's decision", () => {
  const pending = () => {
    const result = requestRefund({ orderId: "CSL-1004", reason: "Not for me" });
    if (result.status !== "pending_approval") throw new Error("should wait");
    return result.refund;
  };

  it("approving refunds the order", () => {
    const refund = pending();
    expect(decideRefund(refund.id, "approve")).toMatchObject({
      status: "refunded",
      auto: false,
    });
    expect(findOrders({ orderId: "CSL-1004" })[0].refund?.status).toBe("refunded");
  });

  it("rejecting leaves the order unrefunded", () => {
    expect(decideRefund(pending().id, "reject")?.status).toBe("rejected");
  });

  it("can't decide a refund twice, one that isn't waiting, or one that doesn't exist", () => {
    const refund = pending();
    decideRefund(refund.id, "approve");
    expect(decideRefund(refund.id, "reject")).toBeNull();
    const auto = requestRefund({ orderId: "CSL-1001", reason: "x y z" });
    const autoId = auto.status === "refunded" ? auto.refund.id : "";
    expect(decideRefund(autoId, "reject")).toBeNull();
    expect(decideRefund("RF-999", "approve")).toBeNull();
  });
});

describe("the limit", () => {
  it("starts at $50 and changes", () => {
    expect(getLimit()).toBe(50);
    expect(setLimit(120.5)).toBe(true);
    expect(getLimit()).toBe(120.5);
  });

  it("rejects amounts that make no sense", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000]) {
      expect(setLimit(bad)).toBe(false);
    }
    expect(getLimit()).toBe(50);
  });

  it("resets with the demo data", () => {
    setLimit(5);
    requestRefund({ orderId: "CSL-1001", reason: "x y z" });
    resetRefunds();
    expect(getLimit()).toBe(50);
    expect(allOrders().every((o) => o.refund === null)).toBe(true);
  });
});
