import type {
  BookingReconciliationResult,
  ReconcilePendingBookingsService,
} from "./reconcile-pending-bookings.js";

interface ReconciliationLogger {
  error(context: { component: "booking-reconciliation" }, message: string): void;
  info(
    context: {
      component: "booking-reconciliation";
      result: BookingReconciliationResult;
    },
    message: string,
  ): void;
}

interface BookingReconciliationRunnerDependencies {
  clearInterval(timer: unknown): void;
  intervalMs: number;
  logger: ReconciliationLogger;
  reconcilePendingBookings: Pick<ReconcilePendingBookingsService, "execute">;
  setInterval(task: () => void, intervalMs: number): unknown;
}

export type BookingReconciliationRunOutcome =
  | "completed"
  | "failed"
  | "skipped";

export class BookingReconciliationRunner {
  private activeRun: Promise<BookingReconciliationRunOutcome> | null = null;
  private readonly intervalMs: number;
  private timer: unknown | null = null;

  constructor(
    private readonly dependencies: BookingReconciliationRunnerDependencies,
  ) {
    if (
      !Number.isSafeInteger(dependencies.intervalMs) ||
      dependencies.intervalMs < 1_000
    ) {
      throw new Error("Booking reconciliation interval is invalid.");
    }
    this.intervalMs = dependencies.intervalMs;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = this.dependencies.setInterval(
      () => {
        if (this.timer !== null) void this.runOnce();
      },
      this.intervalMs,
    );
    void this.runOnce();
  }

  async runOnce(): Promise<BookingReconciliationRunOutcome> {
    if (this.activeRun) return "skipped";

    const execution = this.executeBatch();
    this.activeRun = execution;
    try {
      return await execution;
    } finally {
      if (this.activeRun === execution) this.activeRun = null;
    }
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      this.dependencies.clearInterval(this.timer);
      this.timer = null;
    }
    await this.activeRun;
  }

  private async executeBatch(): Promise<BookingReconciliationRunOutcome> {
    try {
      const result = await this.dependencies.reconcilePendingBookings.execute();
      this.dependencies.logger.info(
        { component: "booking-reconciliation", result },
        "Booking reconciliation completed",
      );
      return "completed";
    } catch {
      this.dependencies.logger.error(
        { component: "booking-reconciliation" },
        "Booking reconciliation failed",
      );
      return "failed";
    }
  }
}

export const systemReconciliationTimer = {
  clearInterval: (timer: unknown) => clearInterval(timer as NodeJS.Timeout),
  setInterval: (task: () => void, intervalMs: number): unknown =>
    setInterval(task, intervalMs),
};
