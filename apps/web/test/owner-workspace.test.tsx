import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../src/api-client.js";
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
const policy = {
  bookingWindowDays: 60,
  minimumNoticeMinutes: 120,
  slotDurationMinutes: 30,
  timeZone: "America/Bogota",
  windows: [{ endMinute: 720, startMinute: 540, weekday: 1 }],
};

function createClient(overrides: Partial<OwnerWorkspaceClient> = {}): OwnerWorkspaceClient {
  return {
    getAvailabilityPolicy: vi.fn(async () => ({ policy, tenantId })),
    getGoogleConnectionStatus: vi.fn(async () => ({
      calendarId: "primary",
      connected: true as const,
      connectedAt: "2026-08-20T12:00:00.000Z",
      googleAccountEmail: "calendar-owner@example.com",
      grantedScopes: ["calendar.readonly", "calendar.events"],
      tenantId,
      updatedAt: "2026-08-20T13:00:00.000Z",
    })),
    getSession: vi.fn(async () => session),
    signIn: vi.fn(async () => ({ email: session.email, userId: session.userId })),
    signOut: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("OwnerWorkspace", () => {
  it("restores an owner session and loads only its selected tenant resources", async () => {
    const client = createClient();
    render(<OwnerWorkspace client={client} />);

    expect(screen.getByText("Checking your session...")).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Your scheduling workspace" })).toBeVisible();
    expect(screen.getByText("owner@example.com")).toBeVisible();
    expect(screen.getByText("Google Calendar connected")).toBeVisible();
    expect(screen.getByText("America/Bogota")).toBeVisible();
    expect(screen.getByText("30-minute appointments")).toBeVisible();
    expect(client.getGoogleConnectionStatus).toHaveBeenCalledWith(tenantId);
    expect(client.getAvailabilityPolicy).toHaveBeenCalledWith(tenantId);
  });

  it("signs in through the hardened session cookie and then reloads the principal", async () => {
    const user = userEvent.setup();
    const getSession = vi
      .fn<OwnerWorkspaceClient["getSession"]>()
      .mockRejectedValueOnce(new ApiClientError("invalid_session", 401))
      .mockResolvedValueOnce(session);
    const client = createClient({ getSession });
    render(<OwnerWorkspace client={client} />);

    await user.type(await screen.findByLabelText("Email address"), "owner@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Sign in securely" }));

    expect(await screen.findByRole("heading", { name: "Your scheduling workspace" })).toBeVisible();
    expect(client.signIn).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "correct horse battery staple",
    });
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(screen.queryByDisplayValue("correct horse battery staple")).not.toBeInTheDocument();
  });

  it("maps invalid credentials to one safe sign-in message", async () => {
    const user = userEvent.setup();
    const client = createClient({
      getSession: vi.fn(async () => {
        throw new ApiClientError("invalid_session", 401);
      }),
      signIn: vi.fn(async () => {
        throw new ApiClientError("invalid_credentials", 401);
      }),
    });
    render(<OwnerWorkspace client={client} />);

    await user.type(await screen.findByLabelText("Email address"), "owner@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong password value");
    await user.click(screen.getByRole("button", { name: "Sign in securely" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
  });

  it("revokes the owner session and returns to the sign-in boundary", async () => {
    const user = userEvent.setup();
    const client = createClient();
    render(<OwnerWorkspace client={client} />);

    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(client.signOut).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", { name: "Sign in to continue" })).toBeVisible();
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();
  });

  it("does not load tenant resources when the session has no owner membership", async () => {
    const client = createClient({
      getSession: vi.fn(async () => ({
        ...session,
        memberships: [{ role: "member" as const, tenantId }],
      })),
    });
    render(<OwnerWorkspace client={client} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No owner workspace is available for this account.",
    );
    expect(client.getGoogleConnectionStatus).not.toHaveBeenCalled();
    expect(client.getAvailabilityPolicy).not.toHaveBeenCalled();
  });

  it("hides tenant dependency failures behind one safe workspace state", async () => {
    const client = createClient({
      getGoogleConnectionStatus: vi.fn(async () => {
        throw new Error("provider and credential detail");
      }),
    });
    render(<OwnerWorkspace client={client} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The owner workspace is temporarily unavailable. Please try again.",
    );
    expect(screen.queryByText("provider and credential detail")).not.toBeInTheDocument();
  });
});
