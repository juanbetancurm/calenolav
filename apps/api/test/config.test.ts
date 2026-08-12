import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";

describe("API configuration", () => {
  it("uses safe local HTTP defaults", () => {
    expect(readConfig({ DATABASE_URL: "postgresql://example" })).toEqual({
      databaseUrl: "postgresql://example",
      host: "0.0.0.0",
      port: 3000,
    });
  });

  it("accepts explicit host and port settings", () => {
    expect(
      readConfig({
        API_HOST: "127.0.0.1",
        API_PORT: "4000",
        DATABASE_URL: "postgresql://example",
      }),
    ).toMatchObject({ host: "127.0.0.1", port: 4000 });
  });

  it("rejects missing database configuration", () => {
    expect(() => readConfig({})).toThrow("DATABASE_URL is required");
  });

  it.each(["0", "65536", "not-a-port"])("rejects invalid API_PORT %s", (port) => {
    expect(() =>
      readConfig({ API_PORT: port, DATABASE_URL: "postgresql://example" }),
    ).toThrow("API_PORT must be an integer between 1 and 65535");
  });
});
