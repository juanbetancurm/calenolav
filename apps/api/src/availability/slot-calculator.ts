import { Temporal } from "@js-temporal/polyfill";
import {
  normalizeAvailabilityPolicy,
  type AvailabilityPolicy,
  type WeeklyAvailabilityWindow,
} from "./weekly-policy.js";

export interface BusyInterval {
  endAt: Date;
  startAt: Date;
}

export interface AvailabilitySlot {
  endAt: Date;
  startAt: Date;
}

export interface AvailabilityQueryRange {
  endAt: Date;
  startAt: Date;
}

interface CalculateAvailableSlotsInput {
  busyIntervals: readonly BusyInterval[];
  now: Date;
  policy: AvailabilityPolicy;
}

export class AvailabilityCalculationError extends Error {
  override readonly name = "AvailabilityCalculationError";

  constructor() {
    super("Availability could not be calculated.");
  }
}

interface NumericInterval {
  endAt: number;
  startAt: number;
}

function invalidCalculation(): never {
  throw new AvailabilityCalculationError();
}

export function calculateAvailabilityQueryRange(input: {
  now: Date;
  policy: AvailabilityPolicy;
}): AvailabilityQueryRange {
  const nowMilliseconds = input.now.getTime();
  if (!Number.isFinite(nowMilliseconds)) invalidCalculation();

  const policy = normalizeAvailabilityPolicy(input.policy);
  try {
    const now = Temporal.Instant.fromEpochMilliseconds(nowMilliseconds);
    return {
      endAt: new Date(
        Number(
          now
            .toZonedDateTimeISO(policy.timeZone)
            .add({ days: policy.bookingWindowDays })
            .toInstant().epochMilliseconds,
        ),
      ),
      startAt: new Date(
        Number(
          now.add({ minutes: policy.minimumNoticeMinutes }).epochMilliseconds,
        ),
      ),
    };
  } catch (error) {
    if (error instanceof AvailabilityCalculationError) throw error;
    invalidCalculation();
  }
}

function toNumericBusyIntervals(
  busyIntervals: readonly BusyInterval[],
): NumericInterval[] {
  return busyIntervals.map((interval) => {
    const startAt = interval.startAt.getTime();
    const endAt = interval.endAt.getTime();
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
      invalidCalculation();
    }
    return { endAt, startAt };
  });
}

function minuteOfDayToTime(minuteOfDay: number): Temporal.PlainTime {
  if (minuteOfDay === 24 * 60) {
    return Temporal.PlainTime.from("00:00");
  }
  return Temporal.PlainTime.from({
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
  });
}

function windowBoundary(
  date: Temporal.PlainDate,
  minuteOfDay: number,
  timeZone: string,
  boundary: "end" | "start",
): Temporal.Instant {
  const isEndOfDay = minuteOfDay === 24 * 60;
  const boundaryDate = isEndOfDay ? date.add({ days: 1 }) : date;
  const plainDateTime = boundaryDate.toPlainDateTime(
    minuteOfDayToTime(minuteOfDay),
  );
  return plainDateTime
    .toZonedDateTime(timeZone, {
      disambiguation: boundary === "end" ? "later" : "compatible",
    })
    .toInstant();
}

function isBusy(
  startAt: number,
  endAt: number,
  busyIntervals: readonly NumericInterval[],
): boolean {
  return busyIntervals.some(
    (busy) => busy.startAt < endAt && busy.endAt > startAt,
  );
}

function appendWindowSlots(
  slots: AvailabilitySlot[],
  date: Temporal.PlainDate,
  window: WeeklyAvailabilityWindow,
  policy: AvailabilityPolicy,
  earliest: Temporal.Instant,
  horizon: Temporal.Instant,
  busyIntervals: readonly NumericInterval[],
): void {
  let slotStart = windowBoundary(
    date,
    window.startMinute,
    policy.timeZone,
    "start",
  );
  const windowEnd = windowBoundary(
    date,
    window.endMinute,
    policy.timeZone,
    "end",
  );

  while (true) {
    const slotEnd = slotStart.add({ minutes: policy.slotDurationMinutes });
    if (Temporal.Instant.compare(slotEnd, windowEnd) > 0) break;

    if (
      Temporal.Instant.compare(slotStart, earliest) >= 0 &&
      Temporal.Instant.compare(slotEnd, horizon) <= 0
    ) {
      const startAt = Number(slotStart.epochMilliseconds);
      const endAt = Number(slotEnd.epochMilliseconds);
      if (!isBusy(startAt, endAt, busyIntervals)) {
        slots.push({ endAt: new Date(endAt), startAt: new Date(startAt) });
      }
    }

    slotStart = slotEnd;
  }
}

export function calculateAvailableSlots(
  input: CalculateAvailableSlotsInput,
): AvailabilitySlot[] {
  const nowMilliseconds = input.now.getTime();
  if (!Number.isFinite(nowMilliseconds)) invalidCalculation();

  const policy = normalizeAvailabilityPolicy(input.policy);
  const busyIntervals = toNumericBusyIntervals(input.busyIntervals);

  try {
    const range = calculateAvailabilityQueryRange({ now: input.now, policy });
    const earliest = Temporal.Instant.fromEpochMilliseconds(
      range.startAt.getTime(),
    );
    const horizon = Temporal.Instant.fromEpochMilliseconds(range.endAt.getTime());
    const finalDate = horizon.toZonedDateTimeISO(policy.timeZone).toPlainDate();
    const slots: AvailabilitySlot[] = [];

    for (
      let date = earliest.toZonedDateTimeISO(policy.timeZone).toPlainDate();
      Temporal.PlainDate.compare(date, finalDate) <= 0;
      date = date.add({ days: 1 })
    ) {
      for (const window of policy.windows) {
        if (window.weekday === date.dayOfWeek) {
          appendWindowSlots(
            slots,
            date,
            window,
            policy,
            earliest,
            horizon,
            busyIntervals,
          );
        }
      }
    }

    return slots;
  } catch (error) {
    if (error instanceof AvailabilityCalculationError) throw error;
    invalidCalculation();
  }
}
