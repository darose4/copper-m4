// The Refund Console: orders to refund, a limit you can change, and Approve /
// Reject for refunds over it. Runs against the real refund code (no mocks).
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REFUND_DECIDED_EVENT } from "@/components/copper/ask-copper";
import { RefundConsole } from "@/components/copper/refund-console";
import { requestRefund, resetRefunds } from "@/lib/copper/refunds";

beforeEach(() => resetRefunds());
afterEach(cleanup);

describe("Refund Console", () => {
  it("lists the orders to refund and starts with the $50 limit", async () => {
    render(<RefundConsole />);
    const orders = await screen.findByTestId("orders");
    await waitFor(() =>
      expect(within(orders).getByText("CSL-1003")).toBeInTheDocument(),
    );
    expect(within(orders).getAllByText("No refund").length).toBeGreaterThan(3);
    expect(screen.getByLabelText("Limit (USD)")).toHaveValue(50);
    expect(screen.getByText(/nothing is waiting/i)).toBeInTheDocument();
  });

  it("saves a new limit, and says so when the amount makes no sense", async () => {
    render(<RefundConsole />);
    const input = await screen.findByLabelText("Limit (USD)");
    await waitFor(() => expect(input).toHaveValue(50));

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limit" }));
    await waitFor(() =>
      expect(screen.getByTestId("limit-status")).toHaveTextContent(
        /limit is now \$0\b/i,
      ),
    );
    // The rule really changed: even a $7.99 refund now waits.
    expect(
      requestRefund({ orderId: "CSL-1001", reason: "x y z" }).status,
    ).toBe("pending_approval");

    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limit" }));
    expect(await screen.findByText(/from \$0 to/i)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limit" }));
    expect(await screen.findByText(/enter an amount/i)).toBeInTheDocument();
  });

  it("shows a refund over the limit with Approve and Reject, and tells the chat what was decided", async () => {
    requestRefund({ orderId: "CSL-1003", reason: "Too big for my desk" });
    const heard: string[] = [];
    const listen = (event: Event) =>
      heard.push((event as CustomEvent<{ text: string }>).detail.text);
    window.addEventListener(REFUND_DECIDED_EVENT, listen);
    try {
      render(<RefundConsole />);
      const waiting = within(await screen.findByTestId("needs-decision"));
      const row = await waiting.findByTestId("pending-refund");
      expect(row).toHaveTextContent("CSL-1003");
      expect(row).toHaveTextContent("$149");
      expect(row).toHaveTextContent("Too big for my desk");

      await act(async () => {
        fireEvent.click(
          waiting.getByRole("button", { name: /approve refund for CSL-1003/i }),
        );
      });
      await waitFor(() => expect(heard).toHaveLength(1));
      expect(heard[0]).toMatch(/approved your refund of \$149 for order CSL-1003/);
      await waitFor(() =>
        expect(screen.queryByTestId("pending-refund")).toBeNull(),
      );
      expect(
        within(screen.getByTestId("orders")).getByText("Refunded (approved)"),
      ).toBeInTheDocument();
    } finally {
      window.removeEventListener(REFUND_DECIDED_EVENT, listen);
    }
  });

  it("Reject keeps the order unrefunded and tells the chat", async () => {
    requestRefund({ orderId: "CSL-1004", reason: "Not for me" });
    const heard: string[] = [];
    const listen = (event: Event) =>
      heard.push((event as CustomEvent<{ text: string }>).detail.text);
    window.addEventListener(REFUND_DECIDED_EVENT, listen);
    try {
      render(<RefundConsole />);
      fireEvent.click(
        await screen.findByRole("button", { name: /reject refund for CSL-1004/i }),
      );
      await waitFor(() => expect(heard).toHaveLength(1));
      expect(heard[0]).toMatch(/order CSL-1004.*couldn't approve/);
      await waitFor(() =>
        expect(
          within(screen.getByTestId("orders")).getByText("Rejected"),
        ).toBeInTheDocument(),
      );
    } finally {
      window.removeEventListener(REFUND_DECIDED_EVENT, listen);
    }
  });

  it("picks up a new refund by itself, and Reset demo data clears everything", async () => {
    render(<RefundConsole />);
    await screen.findByText(/nothing is waiting/i);
    requestRefund({ orderId: "CSL-1006", reason: "Wrong color" });
    expect(
      await screen.findByTestId("pending-refund", {}, { timeout: 6000 }),
    ).toHaveTextContent("CSL-1006");

    fireEvent.click(screen.getByRole("button", { name: /reset demo data/i }));
    await screen.findByText(/nothing is waiting/i);
  }, 15000);
});

