import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvalidSessionError } from "../src/auth/session-services.js";
import {
  GoogleOAuthCallbackError,
  type CompleteGoogleOAuthService,
} from "../src/google/oauth-callback.js";
import { registerGoogleOAuthRoutes } from "../src/google/oauth-routes.js";

const apps: ReturnType<typeof Fastify>[] = [];
const tenantId = "00000000-0000-4000-8000-000000000002";

function createApp(
  completeGoogleOAuth: CompleteGoogleOAuthService["execute"] = vi.fn(
    async () => ({ tenantId }),
  ),
) {
  const app = Fastify({ logger: false });
  apps.push(app);
  const authenticateSession = vi.fn(async () => {
    throw new InvalidSessionError();
  });

  void app.register(registerGoogleOAuthRoutes, {
    authenticateSession: { execute: authenticateSession },
    beginGoogleOAuth: {
      execute: vi.fn(async () => ({
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      })),
    },
    completeGoogleOAuth: { execute: completeGoogleOAuth },
  });

  return { app, authenticateSession, completeGoogleOAuth };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("GET /google/oauth/callback", () => {
  it("completes the one-time attempt without requiring a session cookie", async () => {
    const { app, authenticateSession, completeGoogleOAuth } = createApp();

    const response = await app.inject({
      method: "GET",
      url: "/google/oauth/callback?code=authorization-code&state=opaque-state",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: { status: "connected", tenantId },
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(completeGoogleOAuth).toHaveBeenCalledWith({
      code: "authorization-code",
      state: "opaque-state",
    });
    expect(authenticateSession).not.toHaveBeenCalled();
  });

  it("returns one privacy-safe failure when callback completion is rejected", async () => {
    const completeGoogleOAuth = vi.fn(async () => {
      throw new GoogleOAuthCallbackError();
    });
    const { app } = createApp(completeGoogleOAuth);

    const response = await app.inject({
      method: "GET",
      url: "/google/oauth/callback?code=rejected-code&state=rejected-state",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "google_oauth_callback_failed" },
    });
    expect(response.body).not.toContain("rejected-code");
    expect(response.body).not.toContain("rejected-state");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("rejects provider errors or incomplete query values before the service", async () => {
    const { app, completeGoogleOAuth } = createApp();

    const providerError = await app.inject({
      method: "GET",
      url: "/google/oauth/callback?error=access_denied&state=opaque-state",
    });
    const missingState = await app.inject({
      method: "GET",
      url: "/google/oauth/callback?code=authorization-code",
    });

    for (const response of [providerError, missingState]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: { code: "google_oauth_callback_failed" },
      });
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
    }
    expect(completeGoogleOAuth).not.toHaveBeenCalled();
  });
});
