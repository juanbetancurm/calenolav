export interface WeeklyAvailabilityWindow {
  endMinute: number;
  startMinute: number;
  weekday: number;
}

export interface AvailabilityPolicy {
  bookingWindowDays: number;
  minimumNoticeMinutes: number;
  slotDurationMinutes: number;
  timeZone: string;
  windows: readonly WeeklyAvailabilityWindow[];
}

export class AvailabilityPolicyValidationError extends Error {
  override readonly name = "AvailabilityPolicyValidationError";

  constructor() {
    super("Availability policy is invalid.");
  }
}

const minuteGrid = 5;
const minutesPerDay = 24 * 60;
const maximumMinimumNoticeMinutes = 30 * minutesPerDay;
const maximumBookingWindowDays = 365;
const maximumSlotDurationMinutes = 8 * 60;

function isGridInteger(value: number): boolean {
  return Number.isInteger(value) && value % minuteGrid === 0;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function invalidPolicy(): never {
  throw new AvailabilityPolicyValidationError();
}

export function normalizeAvailabilityPolicy(
  policy: AvailabilityPolicy,
): AvailabilityPolicy {
  const timeZone = policy.timeZone.trim();
  if (timeZone.length === 0 || timeZone.length > 100 || !isValidTimeZone(timeZone)) {
    invalidPolicy();
  }
  if (
    !isGridInteger(policy.slotDurationMinutes) ||
    policy.slotDurationMinutes < minuteGrid ||
    policy.slotDurationMinutes > maximumSlotDurationMinutes
  ) {
    invalidPolicy();
  }
  if (
    !isGridInteger(policy.minimumNoticeMinutes) ||
    policy.minimumNoticeMinutes < 0 ||
    policy.minimumNoticeMinutes > maximumMinimumNoticeMinutes
  ) {
    invalidPolicy();
  }
  if (
    !Number.isInteger(policy.bookingWindowDays) ||
    policy.bookingWindowDays < 1 ||
    policy.bookingWindowDays > maximumBookingWindowDays
  ) {
    invalidPolicy();
  }

  const windows = policy.windows
    .map((window) => ({ ...window }))
    .sort(
      (left, right) =>
        left.weekday - right.weekday || left.startMinute - right.startMinute,
    );

  for (const [index, window] of windows.entries()) {
    if (
      !Number.isInteger(window.weekday) ||
      window.weekday < 1 ||
      window.weekday > 7 ||
      !isGridInteger(window.startMinute) ||
      window.startMinute < 0 ||
      window.startMinute >= minutesPerDay ||
      !isGridInteger(window.endMinute) ||
      window.endMinute <= window.startMinute ||
      window.endMinute > minutesPerDay ||
      window.endMinute - window.startMinute < policy.slotDurationMinutes
    ) {
      invalidPolicy();
    }

    const previous = windows[index - 1];
    if (
      previous &&
      previous.weekday === window.weekday &&
      previous.endMinute > window.startMinute
    ) {
      invalidPolicy();
    }
  }

  return {
    bookingWindowDays: policy.bookingWindowDays,
    minimumNoticeMinutes: policy.minimumNoticeMinutes,
    slotDurationMinutes: policy.slotDurationMinutes,
    timeZone,
    windows,
  };
}
