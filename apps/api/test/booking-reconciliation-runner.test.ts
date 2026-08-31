import { describe, expect, it, vi } from "vitest";
import { BookingReconciliationRunner } from "../src/booking/booking-reconciliation-runner.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("booking reconciliation runner", () => {
  it("runs immediately, schedules a bounded interval, and logs aggregates only", async () => {
    const execute = vi.fn(async () => ({
      claimed: 3,
      confirmed: 2,
      retryable: 1,
    }));
    const info = vi.fn();
    const error = vi.fn();
    let scheduledTask: (() => void) | undefined;
    const timer = { id: "synthetic-timer" };
    const setInterval = vi.fn((task: () => void, intervalMs: number) => {
      scheduledTask = task;
      expect(intervalMs).toBe(60_000);
      return timer;
    });
    const clearInterval = vi.fn();
    const runner = new BookingReconciliationRunner({
      clearInterval,
      intervalMs: 60_000,
      logger: { error, info },
      reconcilePendingBookings: { execute },
      setInterval,
    });

    runner.start();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(info).toHaveBeenCalledOnce());
    expect(info).toHaveBeenCalledWith(
      {
        component: "booking-reconciliation",
        result: { claimed: 3, confirmed: 2, retryable: 1 },
      },
      "Booking reconciliation completed",
    );
    expect(error).not.toHaveBeenCalled();

    scheduledTask?.();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    await runner.stop();
    expect(clearInterval).toHaveBeenCalledWith(timer);
    scheduledTask?.();
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("prevents overlapping batches and waits for the active batch on stop", async () => {
    const batch = deferred<{
      claimed: number;
      confirmed: number;
      retryable: number;
    }>();
    const execute = vi.fn(() => batch.promise);
    const runner = new BookingReconciliationRunner({
      clearInterval: vi.fn(),
      intervalMs: 60_000,
      logger: { error: vi.fn(), info: vi.fn() },
      reconcilePendingBookings: { execute },
      setInterval: vi.fn(() => ({ id: "timer" })),
    });

    runner.start();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    await expect(runner.runOnce()).resolves.toBe("skipped");

    let stopped = false;
    const stopping = runner.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    batch.resolve({ claimed: 1, confirmed: 1, retryable: 0 });
    await stopping;
    expect(stopped).toBe(true);
  });

  it("contains batch failures behind one stable privacy-safe log", async () => {
    const failure = new Error("attendee@example.com refresh token rejected");
    const info = vi.fn();
    const error = vi.fn();
    const runner = new BookingReconciliationRunner({
      clearInterval: vi.fn(),
      intervalMs: 60_000,
      logger: { error, info },
      reconcilePendingBookings: { execute: vi.fn(async () => Promise.reject(failure)) },
      setInterval: vi.fn(() => ({ id: "timer" })),
    });

    await expect(runner.runOnce()).resolves.toBe("failed");
    expect(error).toHaveBeenCalledWith(
      { component: "booking-reconciliation" },
      "Booking reconciliation failed",
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("attendee@example.com");
    expect(info).not.toHaveBeenCalled();
  });

  it("rejects unsafe interval configuration", () => {
    expect(
      () =>
        new BookingReconciliationRunner({
          clearInterval: vi.fn(),
          intervalMs: 0,
          logger: { error: vi.fn(), info: vi.fn() },
          reconcilePendingBookings: {
            execute: vi.fn(async () => ({ claimed: 0, confirmed: 0, retryable: 0 })),
          },
          setInterval: vi.fn(() => ({ id: "timer" })),
        }),
    ).toThrow("Booking reconciliation interval is invalid");
  });
});
