import cookie from "@fastify/cookie";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import {
  InvalidCredentialsError,
  InvalidSessionError,
  type AuthenticateSessionService,
  type SignInCommand,
  type SignInService,
  type SignOutService,
} from "./session-services.js";

interface SessionRoutesOptions {
  authenticateSession: Pick<AuthenticateSessionService, "execute">;
  secureCookies: boolean;
  signIn: Pick<SignInService, "execute">;
  signOut: Pick<SignOutService, "execute">;
}

const sessionCookieName = "calenolav_session";
const signInBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["email", "password"],
  properties: {
    email: { type: "string", maxLength: 320 },
    password: { type: "string", maxLength: 128 },
  },
} as const;

function preventCaching(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
}

export const registerSessionRoutes: FastifyPluginAsync<SessionRoutesOptions> = async (
  app,
  options,
) => {
  await app.register(cookie);

  app.post<{ Body: SignInCommand }>(
    "/auth/sign-in",
    { schema: { body: signInBodySchema } },
    async (request, reply) => {
      preventCaching(reply);
      try {
        const result = await options.signIn.execute(request.body);
        reply.setCookie(sessionCookieName, result.sessionToken, {
          expires: result.expiresAt,
          httpOnly: true,
          path: "/",
          sameSite: "lax",
          secure: options.secureCookies,
        });
        return { email: result.email, userId: result.userId };
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          return reply.code(401).send({ error: { code: "invalid_credentials" } });
        }
        throw error;
      }
    },
  );

  app.get("/auth/session", async (request, reply) => {
    preventCaching(reply);
    const rawToken = request.cookies[sessionCookieName];
    if (!rawToken) {
      return reply.code(401).send({ error: { code: "invalid_session" } });
    }

    try {
      return await options.authenticateSession.execute(rawToken);
    } catch (error) {
      if (error instanceof InvalidSessionError) {
        return reply.code(401).send({ error: { code: "invalid_session" } });
      }
      throw error;
    }
  });

  app.post("/auth/sign-out", async (request, reply) => {
    preventCaching(reply);
    const rawToken = request.cookies[sessionCookieName];
    if (rawToken) {
      await options.signOut.execute(rawToken);
    }

    reply.clearCookie(sessionCookieName, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: options.secureCookies,
    });
    reply.header("Clear-Site-Data", '"cache", "cookies", "storage"');
    return reply.code(204).send();
  });
};
