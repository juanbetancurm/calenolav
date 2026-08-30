import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";

const tenantId = "00000000-0000-4000-8000-000000000812";

describe("owner workspace app wiring", () => {
  it("connects the private owner route to session-backed workspace state", async () => {
    const ownerClient = {
      getAvailabilityPolicy: vi.fn(async () => ({
        policy: {
          bookingWindowDays: 60,
          minimumNoticeMinutes: 120,
          slotDurationMinutes: 30,
          timeZone: "America/Bogota",
          windows: [],
        },
        tenantId,
      })),
      getGoogleConnectionStatus: vi.fn(async () => ({ connected: false as const, tenantId })),
      getSession: vi.fn(async () => ({
        email: "owner@example.com",
        memberships: [{ role: "owner" as const, tenantId }],
        userId: "00000000-0000-4000-8000-000000000811",
      })),
      signIn: vi.fn(),
      signOut: vi.fn(async () => undefined),
    };

    render(<App ownerClient={ownerClient} path="/owner" />);

    expect(await screen.findByRole("heading", { name: "Your scheduling workspace" })).toBeVisible();
    expect(ownerClient.getSession).toHaveBeenCalledOnce();
    expect(ownerClient.getAvailabilityPolicy).toHaveBeenCalledWith(tenantId);
  });
});
