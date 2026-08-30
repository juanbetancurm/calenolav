import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";

afterEach(() => {
  document.title = "";
});

describe("calenolav application shell", () => {
  it("offers clear visitor and owner entry points", () => {
    render(<App path="/" />);

    expect(screen.getByRole("heading", { name: "Scheduling, without the back-and-forth" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Schedule an appointment" })).toHaveAttribute("href", "/book");
    expect(screen.getByRole("link", { name: "Manage my calendar" })).toHaveAttribute("href", "/owner");
    expect(document.title).toBe("calenolav | Private scheduling");
  });

  it("renders the visitor booking shell for a safe tenant slug", () => {
    render(<App path="/book/example-tenant" />);

    expect(screen.getByRole("heading", { name: "Book an appointment" })).toBeVisible();
    expect(screen.getByText("example tenant")).toBeVisible();
    expect(screen.getByText("Choose a time")).toBeVisible();
    expect(document.title).toBe("Book an appointment | calenolav");
  });

  it("renders the owner workspace without exposing it as a visitor route", () => {
    render(<App path="/owner" />);

    expect(screen.getByRole("heading", { name: "Manage your calendar" })).toBeVisible();
    expect(screen.getByText("Sign in to continue")).toBeVisible();
    expect(screen.queryByText("Choose a time")).not.toBeInTheDocument();
    expect(document.title).toBe("Owner workspace | calenolav");
  });

  it("uses one not-found view for unsafe or unknown paths", () => {
    render(<App path="/book/Not_Safe" />);

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute("href", "/");
  });
});
