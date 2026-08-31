import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError, type AvailabilityPolicy } from "../src/api-client.js";
import {
  OwnerWorkspace,
  type OwnerWorkspaceClient,
} from "../src/owner-workspace.js";

const tenantId = "00000000-0000-4000-8000-000000000812";
const session = {
  email: "owner@example.com",
  memberships: [{ role: "owner" as const, tenantId }],
  userId: "00000000-0000-4000-8000-000000000811",
};
const policy: AvailabilityPolicy = {
  bookingWindowDays: 60,
  minimumNoticeMinutes: 120,
  slotDurationMinutes: 30,
  timeZone: "America/Bogota",
  windows: [{ endMinute: 720, startMinute: 540, weekday: 1 }],
};

interface OwnerManagementClient extends OwnerWorkspaceClient {
  disconnectGoogleCalendar(tenantId: string): Promise<void>;
  getGoogleAuthorizationUrl(tenantId: string): string;
  replaceAvailabilityPolicy(
    tenantId: string,
    policy: AvailabilityPolicy,
  ): Promise<{ readonly policy: AvailabilityPolicy; readonly tenantId: string }>;
}

function createClient(overrides: Partial<OwnerManagementClient> = {}): OwnerManagementClient {
  return {
    disconnectGoogleCalendar: vi.fn(async () => undefined),
    getAvailabilityPolicy: vi.fn(async () => ({ policy, tenantId })),
    getGoogleAuthorizationUrl: vi.fn(() => `/tenants/${tenantId}/google/oauth/start`),
    getGoogleConnectionStatus: vi.fn(async () => ({ connected: false as const, tenantId })),
    getSession: vi.fn(async () => session),
    replaceAvailabilityPolicy: vi.fn(async (_tenantId, nextPolicy) => ({
      policy: nextPolicy,
      tenantId,
    })),
    signIn: vi.fn(async () => ({ email: session.email, userId: session.userId })),
    signOut: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("OwnerWorkspace management", () => {
  it("offers the exact tenant OAuth entry when Google is disconnected", async () => {
    const client = createClient();
    render(<OwnerWorkspace client={client} />);

    expect(await screen.findByRole("link", { name: "Connect Google Calendar" })).toHaveAttribute(
      "href",
      `/tenants/${tenantId}/google/oauth/start`,
    );
    expect(client.getGoogleAuthorizationUrl).toHaveBeenCalledWith(tenantId);
  });

  it("disconnects locally and refreshes the connection summary", async () => {
    const user = userEvent.setup();
    const getGoogleConnectionStatus = vi
      .fn<OwnerManagementClient["getGoogleConnectionStatus"]>()
      .mockResolvedValueOnce({
        calendarId: "primary",
        connected: true,
        connectedAt: "2026-08-20T12:00:00.000Z",
        googleAccountEmail: "calendar-owner@example.com",
        grantedScopes: ["calendar.readonly", "calendar.events"],
        tenantId,
        updatedAt: "2026-08-20T13:00:00.000Z",
      })
      .mockResolvedValueOnce({ connected: false, tenantId });
    const client = createClient({ getGoogleConnectionStatus });
    render(<OwnerWorkspace client={client} />);

    await user.click(await screen.findByRole("button", { name: "Disconnect Google Calendar" }));

    expect(client.disconnectGoogleCalendar).toHaveBeenCalledWith(tenantId);
    expect(await screen.findByText("Google Calendar disconnected")).toBeVisible();
    expect(getGoogleConnectionStatus).toHaveBeenCalledTimes(2);
  });

  it("replaces scalar settings while preserving canonical weekly windows", async () => {
    const user = userEvent.setup();
    const client = createClient({
      getGoogleConnectionStatus: vi.fn(async () => ({ connected: false as const, tenantId })),
    });
    render(<OwnerWorkspace client={client} />);

    await user.clear(await screen.findByLabelText("Time zone"));
    await user.type(screen.getByLabelText("Time zone"), "America/New_York");
    await user.clear(screen.getByLabelText("Appointment length (minutes)"));
    await user.type(screen.getByLabelText("Appointment length (minutes)"), "45");
    await user.clear(screen.getByLabelText("Minimum notice (minutes)"));
    await user.type(screen.getByLabelText("Minimum notice (minutes)"), "180");
    await user.clear(screen.getByLabelText("Booking horizon (days)"));
    await user.type(screen.getByLabelText("Booking horizon (days)"), "90");
    await user.click(screen.getByRole("button", { name: "Save availability" }));

    await waitFor(() => {
      expect(client.replaceAvailabilityPolicy).toHaveBeenCalledWith(tenantId, {
        bookingWindowDays: 90,
        minimumNoticeMinutes: 180,
        slotDurationMinutes: 45,
        timeZone: "America/New_York",
        windows: policy.windows,
      });
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Availability policy saved.");
  });

  it("adds a weekly wall-time window and converts it to canonical minutes", async () => {
    const user = userEvent.setup();
    const emptyPolicy = { ...policy, windows: [] };
    const client = createClient({
      getAvailabilityPolicy: vi.fn(async () => ({ policy: emptyPolicy, tenantId })),
    });
    render(<OwnerWorkspace client={client} />);

    await user.click(await screen.findByRole("button", { name: "Add weekly window" }));
    await user.selectOptions(screen.getByLabelText("Weekday"), "5");
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "12:00" } });
    await user.click(screen.getByRole("button", { name: "Save availability" }));

    await waitFor(() => {
      expect(client.replaceAvailabilityPolicy).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          windows: [{ endMinute: 720, startMinute: 540, weekday: 5 }],
        }),
      );
    });
  });

  it("removes a weekly window and maps validation failures to one safe message", async () => {
    const user = userEvent.setup();
    const client = createClient({
      replaceAvailabilityPolicy: vi.fn(async () => {
        throw new ApiClientError("invalid_availability_policy", 400);
      }),
    });
    render(<OwnerWorkspace client={client} />);

    await user.click(await screen.findByRole("button", { name: "Remove Monday window 1" }));
    await user.click(screen.getByRole("button", { name: "Save availability" }));

    expect(client.replaceAvailabilityPolicy).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ windows: [] }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Availability policy could not be saved. Review the schedule and try again.",
    );
  });
});
