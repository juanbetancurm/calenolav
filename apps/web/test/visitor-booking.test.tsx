import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../src/api-client.js";
import {
  VisitorBooking,
  type VisitorBookingClient,
} from "../src/visitor-booking.js";

const firstSlot = {
  endAt: "2026-09-07T15:00:00.000Z",
  startAt: "2026-09-07T14:30:00.000Z",
};
const secondSlot = {
  endAt: "2026-09-07T16:00:00.000Z",
  startAt: "2026-09-07T15:30:00.000Z",
};

function createClient(overrides: Partial<VisitorBookingClient> = {}): VisitorBookingClient {
  return {
    createPublicBooking: vi.fn(async () => ({
      bookingId: "00000000-0000-4000-8000-000000000802",
      ...firstSlot,
      status: "confirmed" as const,
    })),
    getPublicAvailability: vi.fn(async () => ({ slots: [firstSlot, secondSlot] })),
    ...overrides,
  };
}

describe("VisitorBooking", () => {
  it("loads current slots and exposes stable UTC instants through accessible controls", async () => {
    const client = createClient();
    render(<VisitorBooking client={client} slug="example-tenant" />);

    expect(screen.getByText("Checking the calendar...")).toBeVisible();
    const slotButtons = await screen.findAllByRole("button", { name: /^Select 2026-/ });

    expect(slotButtons).toHaveLength(2);
    expect(slotButtons[0]).toHaveAccessibleName(`Select ${firstSlot.startAt}`);
    expect(client.getPublicAvailability).toHaveBeenCalledWith("example-tenant");
  });

  it("submits only visitor-owned fields and renders a safe confirmation", async () => {
    const user = userEvent.setup();
    const client = createClient();
    render(
      <VisitorBooking
        client={client}
        createIdempotencyKey={() => "110ec58a-a0f2-4ac4-8393-c866d813b8d1"}
        slug="example-tenant"
      />,
    );

    await user.click(await screen.findByRole("button", { name: `Select ${firstSlot.startAt}` }));
    await user.type(screen.getByLabelText("Your name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email address"), "visitor@example.com");
    await user.click(screen.getByRole("button", { name: "Confirm appointment" }));

    await waitFor(() => {
      expect(client.createPublicBooking).toHaveBeenCalledWith("example-tenant", {
        attendeeEmail: "visitor@example.com",
        attendeeName: "Ada Lovelace",
        idempotencyKey: "110ec58a-a0f2-4ac4-8393-c866d813b8d1",
        startAt: firstSlot.startAt,
      });
    });
    expect(await screen.findByRole("heading", { name: "You're booked" })).toBeVisible();
    expect(screen.getByText("Your appointment is confirmed.")).toBeVisible();
    expect(screen.queryByText("visitor@example.com")).not.toBeInTheDocument();
  });

  it("publishes an explicit empty state without offering attendee fields", async () => {
    const client = createClient({
      getPublicAvailability: vi.fn(async () => ({ slots: [] })),
    });
    render(<VisitorBooking client={client} slug="example-tenant" />);

    expect(await screen.findByText("No times are available right now.")).toBeVisible();
    expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
    expect(client.createPublicBooking).not.toHaveBeenCalled();
  });

  it("offers a retry after a privacy-safe availability failure", async () => {
    const user = userEvent.setup();
    const getPublicAvailability = vi
      .fn<VisitorBookingClient["getPublicAvailability"]>()
      .mockRejectedValueOnce(new ApiClientError("availability_unavailable", 503))
      .mockResolvedValueOnce({ slots: [firstSlot] });
    const client = createClient({ getPublicAvailability });
    render(<VisitorBooking client={client} slug="example-tenant" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Availability is temporarily unavailable. Please try again.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: `Select ${firstSlot.startAt}` })).toBeVisible();
    expect(getPublicAvailability).toHaveBeenCalledTimes(2);
  });

  it("refreshes availability when the selected slot loses a booking race", async () => {
    const user = userEvent.setup();
    const getPublicAvailability = vi
      .fn<VisitorBookingClient["getPublicAvailability"]>()
      .mockResolvedValueOnce({ slots: [firstSlot] })
      .mockResolvedValueOnce({ slots: [secondSlot] });
    const client = createClient({
      createPublicBooking: vi.fn(async () => {
        throw new ApiClientError("booking_conflict", 409);
      }),
      getPublicAvailability,
    });
    render(<VisitorBooking client={client} slug="example-tenant" />);

    await user.click(await screen.findByRole("button", { name: `Select ${firstSlot.startAt}` }));
    await user.type(screen.getByLabelText("Your name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email address"), "visitor@example.com");
    await user.click(screen.getByRole("button", { name: "Confirm appointment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That time was just taken. Choose another available time.",
    );
    expect(await screen.findByRole("button", { name: `Select ${secondSlot.startAt}` })).toBeVisible();
    expect(getPublicAvailability).toHaveBeenCalledTimes(2);
  });

  it("reuses one idempotency key when a safe retry follows an unavailable response", async () => {
    const user = userEvent.setup();
    const createIdempotencyKey = vi.fn(() => "110ec58a-a0f2-4ac4-8393-c866d813b8d1");
    const createPublicBooking = vi
      .fn<VisitorBookingClient["createPublicBooking"]>()
      .mockRejectedValueOnce(new ApiClientError("booking_unavailable", 503))
      .mockResolvedValueOnce({
        bookingId: "00000000-0000-4000-8000-000000000802",
        ...firstSlot,
        status: "confirmed",
      });
    const client = createClient({ createPublicBooking });
    render(
      <VisitorBooking
        client={client}
        createIdempotencyKey={createIdempotencyKey}
        slug="example-tenant"
      />,
    );

    await user.click(await screen.findByRole("button", { name: `Select ${firstSlot.startAt}` }));
    await user.type(screen.getByLabelText("Your name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email address"), "visitor@example.com");
    await user.click(screen.getByRole("button", { name: "Confirm appointment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Booking is temporarily unavailable. Please try again.",
    );

    await user.click(screen.getByRole("button", { name: "Confirm appointment" }));
    expect(await screen.findByRole("heading", { name: "You're booked" })).toBeVisible();
    expect(createPublicBooking).toHaveBeenCalledTimes(2);
    expect(createPublicBooking.mock.calls[0]?.[1].idempotencyKey).toBe(
      createPublicBooking.mock.calls[1]?.[1].idempotencyKey,
    );
    expect(createIdempotencyKey).toHaveBeenCalledTimes(1);
  });
});
