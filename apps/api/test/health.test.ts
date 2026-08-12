import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp, type ReadinessCheck } from "../src/app.js";

const openApps: Array<ReturnType<typeof buildApp>> = [];

function createApp(readinessCheck: ReadinessCheck) {
  const app = buildApp({ logger: false, readinessCheck });
  openApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

describe("service health contracts", () => {
  it("reports liveness without checking PostgreSQL", async () => {
    const readinessCheck = vi.fn(async () => {
      throw new Error("database details must stay private");
    });
    const app = createApp(readinessCheck);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["content-type"]).toContain("application/json");
    expect(readinessCheck).not.toHaveBeenCalled();
  });

  it("reports readiness when dependency checks pass", async () => {
    const readinessCheck = vi.fn(async () => undefined);
    const app = createApp(readinessCheck);

    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready" });
    expect(readinessCheck).toHaveBeenCalledOnce();
  });

  it("reports a privacy-safe unavailable response when readiness fails", async () => {
    const privateError = "postgresql://private-user:private-password@db/calenolav";
    const app = createApp(async () => {
      throw new Error(privateError);
    });

    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable" });
    expect(response.body).not.toContain(privateError);
  });
});
