export type BookingRequestField =
  | "attendeeEmail"
  | "attendeeName"
  | "idempotencyKey"
  | "startAt"
  | "tenantSlug";

export interface PublicBookingRequest {
  attendeeEmail: string;
  attendeeName: string;
  idempotencyKey: string;
  startAt: string;
  tenantSlug: string;
}

export interface NormalizedPublicBookingRequest {
  attendeeEmail: string;
  attendeeName: string;
  idempotencyKey: string;
  startAt: Date;
  tenantSlug: string;
}

export class BookingRequestValidationError extends Error {
  override readonly name = "BookingRequestValidationError";

  constructor(readonly field: BookingRequestField) {
    super("Booking request is invalid.");
  }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const uuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function invalid(field: BookingRequestField): never {
  throw new BookingRequestValidationError(field);
}

function countCodePoints(value: string): number {
  return [...value].length;
}

export function normalizePublicBookingRequest(
  request: PublicBookingRequest,
): NormalizedPublicBookingRequest {
  const tenantSlug = request.tenantSlug.trim().toLowerCase();
  if (tenantSlug.length > 63 || !slugPattern.test(tenantSlug)) {
    invalid("tenantSlug");
  }

  const attendeeEmail = request.attendeeEmail.trim().toLowerCase();
  if (attendeeEmail.length > 320 || !emailPattern.test(attendeeEmail)) {
    invalid("attendeeEmail");
  }

  const attendeeName = request.attendeeName.trim();
  const attendeeNameLength = countCodePoints(attendeeName);
  if (
    attendeeNameLength < 1 ||
    attendeeNameLength > 120 ||
    controlCharacterPattern.test(attendeeName)
  ) {
    invalid("attendeeName");
  }

  const idempotencyKey = request.idempotencyKey.trim().toLowerCase();
  if (!uuidV4Pattern.test(idempotencyKey)) {
    invalid("idempotencyKey");
  }

  const startAtText = request.startAt.trim();
  const startAt = new Date(startAtText);
  if (
    !Number.isFinite(startAt.getTime()) ||
    startAt.toISOString() !== startAtText ||
    startAt.getUTCMinutes() % 5 !== 0 ||
    startAt.getUTCSeconds() !== 0 ||
    startAt.getUTCMilliseconds() !== 0
  ) {
    invalid("startAt");
  }

  return {
    attendeeEmail,
    attendeeName,
    idempotencyKey,
    startAt,
    tenantSlug,
  };
}
