import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ApiClientError,
  type AvailabilitySlot,
  type PublicAvailability,
  type PublicBooking,
  type PublicBookingInput,
} from "./api-client.js";

export interface VisitorBookingClient {
  getPublicAvailability(slug: string): Promise<PublicAvailability>;
  createPublicBooking(slug: string, input: PublicBookingInput): Promise<PublicBooking>;
}

interface VisitorBookingProps {
  readonly client: VisitorBookingClient;
  readonly createIdempotencyKey?: () => string;
  readonly slug: string;
}

type AvailabilityState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly slots: readonly AvailabilitySlot[] }
  | { readonly kind: "unavailable" };

interface BookingSelection {
  readonly idempotencyKey: string;
  readonly slot: AvailabilitySlot;
}

const defaultCreateIdempotencyKey = () => crypto.randomUUID();

function formatSlot(slot: AvailabilitySlot): string {
  const formatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return formatter.format(new Date(slot.startAt));
}

export function VisitorBooking({
  client,
  createIdempotencyKey = defaultCreateIdempotencyKey,
  slug,
}: VisitorBookingProps) {
  const [availability, setAvailability] = useState<AvailabilityState>({ kind: "loading" });
  const [selection, setSelection] = useState<BookingSelection | null>(null);
  const [booking, setBooking] = useState<PublicBooking | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadAvailability = useCallback(async (showLoading = true) => {
    if (showLoading) setAvailability({ kind: "loading" });
    try {
      const result = await client.getPublicAvailability(slug);
      setAvailability({ kind: "ready", slots: result.slots });
    } catch {
      setAvailability({ kind: "unavailable" });
    }
  }, [client, slug]);

  useEffect(() => {
    void loadAvailability();
  }, [loadAvailability]);

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selection === null || isSubmitting) return;

    const form = new FormData(event.currentTarget);
    const attendeeName = String(form.get("attendeeName") ?? "");
    const attendeeEmail = String(form.get("attendeeEmail") ?? "");

    setBookingError(null);
    setIsSubmitting(true);
    try {
      const result = await client.createPublicBooking(slug, {
        attendeeEmail,
        attendeeName,
        idempotencyKey: selection.idempotencyKey,
        startAt: selection.slot.startAt,
      });
      setBooking(result);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        setBookingError("That time was just taken. Choose another available time.");
        setSelection(null);
        await loadAvailability(false);
      } else if (error instanceof ApiClientError && error.status === 503) {
        setBookingError("Booking is temporarily unavailable. Please try again.");
      } else {
        setBookingError("We could not confirm that appointment. Check your details and try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (booking !== null) {
    return (
      <div className="booking-result" aria-live="polite">
        <p className="confirmation-mark" aria-hidden="true">&#10003;</p>
        <h2>You're booked</h2>
        <p>Your appointment is confirmed.</p>
        <time dateTime={booking.startAt}>{formatSlot(booking)}</time>
      </div>
    );
  }

  return (
    <div className="visitor-booking">
      {bookingError !== null && <p className="booking-alert" role="alert">{bookingError}</p>}

      {availability.kind === "loading" && (
        <p className="booking-status" role="status">Checking the calendar...</p>
      )}

      {availability.kind === "unavailable" && (
        <div className="booking-state-panel">
          <p role="alert">Availability is temporarily unavailable. Please try again.</p>
          <button className="button button-secondary" type="button" onClick={() => void loadAvailability()}>
            Try again
          </button>
        </div>
      )}

      {availability.kind === "ready" && availability.slots.length === 0 && (
        <p className="booking-status">No times are available right now.</p>
      )}

      {availability.kind === "ready" && availability.slots.length > 0 && selection === null && (
        <div className="slot-list" aria-label="Available appointment times">
          {availability.slots.map((slot) => (
            <button
              className="slot-button"
              type="button"
              key={slot.startAt}
              aria-label={`Select ${slot.startAt}`}
              onClick={() => {
                setBookingError(null);
                setSelection({ idempotencyKey: createIdempotencyKey(), slot });
              }}
            >
              <time dateTime={slot.startAt}>{formatSlot(slot)}</time>
              <span aria-hidden="true">Choose</span>
            </button>
          ))}
        </div>
      )}

      {selection !== null && (
        <form className="visitor-details" onSubmit={(event) => void submitBooking(event)}>
          <button className="back-button" type="button" onClick={() => setSelection(null)}>
            Choose a different time
          </button>
          <p className="selected-time"><strong>Selected time</strong><time dateTime={selection.slot.startAt}>{formatSlot(selection.slot)}</time></p>
          <label htmlFor="visitor-name">Your name</label>
          <input id="visitor-name" name="attendeeName" type="text" autoComplete="name" maxLength={120} required />
          <label htmlFor="visitor-email">Email address</label>
          <input id="visitor-email" name="attendeeEmail" type="email" autoComplete="email" maxLength={320} required />
          <button className="button button-primary full-width" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Confirming..." : "Confirm appointment"}
          </button>
        </form>
      )}
    </div>
  );
}
