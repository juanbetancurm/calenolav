import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";

describe("visitor booking app wiring", () => {
  it("connects a safe tenant route to live public availability", async () => {
    const client = {
      createPublicBooking: vi.fn(),
      getPublicAvailability: vi.fn(async () => ({
        slots: [
          {
            endAt: "2026-09-07T15:00:00.000Z",
            startAt: "2026-09-07T14:30:00.000Z",
          },
        ],
      })),
    };

    render(
      <App
        apiClient={client}
        path="/book/example-tenant"
      />,
    );

    expect(
      await screen.findByRole("button", {
        name: "Select 2026-09-07T14:30:00.000Z",
      }),
    ).toBeVisible();
    expect(client.getPublicAvailability).toHaveBeenCalledWith("example-tenant");
  });
});
