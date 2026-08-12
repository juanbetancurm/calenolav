import type { SessionTokenIssuer } from "./register-owner.js";

export type TenantRole = "member" | "owner";

export interface TenantMembership {
  role: TenantRole;
  tenantId: string;
}

export interface AuthenticatedPrincipal {
  email: string;
  memberships: readonly TenantMembership[];
  userId: string;
}

export interface StoredSession extends AuthenticatedPrincipal {
  expiresAt: Date;
  revokedAt: Date | null;
  sessionId: string;
}

export interface UserCredentials {
  email: string;
  passwordHash: string;
  userId: string;
}

export interface NewSessionRecord {
  expiresAt: Date;
  tokenHash: string;
  userId: string;
}

export interface SessionRepository {
  createSession(session: NewSessionRecord): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null>;
  findUserCredentialsByEmail(email: string): Promise<UserCredentials | null>;
  revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void>;
  touchSession(sessionId: string, lastSeenAt: Date): Promise<void>;
}

export interface PasswordVerifier {
  verify(password: string, storedHash: string): Promise<boolean>;
}

export interface SessionTokenHasher {
  hash(rawToken: string): string;
}

export class InvalidCredentialsError extends Error {
  override readonly name = "InvalidCredentialsError";

  constructor() {
    super("Invalid email or password.");
  }
}

export class InvalidSessionError extends Error {
  override readonly name = "InvalidSessionError";

  constructor() {
    super("The session is missing, expired, or revoked.");
  }
}

export class AuthorizationError extends Error {
  override readonly name = "AuthorizationError";

  constructor() {
    super("The authenticated user is not authorized for this tenant.");
  }
}

interface SignInDependencies {
  clock: () => Date;
  dummyPasswordHash: string;
  passwordVerifier: PasswordVerifier;
  repository: SessionRepository;
  sessionDurationMs: number;
  sessionTokenIssuer: SessionTokenIssuer;
}

export interface SignInCommand {
  email: string;
  password: string;
}

export interface SignInResult {
  email: string;
  expiresAt: Date;
  sessionToken: string;
  userId: string;
}

export class SignInService {
  constructor(private readonly dependencies: SignInDependencies) {
    if (
      !Number.isFinite(dependencies.sessionDurationMs) ||
      dependencies.sessionDurationMs <= 0
    ) {
      throw new Error("sessionDurationMs must be a positive finite number.");
    }
  }

  async execute(command: SignInCommand): Promise<SignInResult> {
    const email = command.email.trim().toLowerCase();
    const credentials = await this.dependencies.repository.findUserCredentialsByEmail(email);
    const passwordHash = credentials?.passwordHash ?? this.dependencies.dummyPasswordHash;
    const passwordIsValid = await this.dependencies.passwordVerifier.verify(
      command.password,
      passwordHash,
    );

    if (!credentials || !passwordIsValid) {
      throw new InvalidCredentialsError();
    }

    const session = this.dependencies.sessionTokenIssuer.issue();
    const expiresAt = new Date(
      this.dependencies.clock().getTime() + this.dependencies.sessionDurationMs,
    );
    await this.dependencies.repository.createSession({
      expiresAt,
      tokenHash: session.tokenHash,
      userId: credentials.userId,
    });

    return {
      email: credentials.email,
      expiresAt,
      sessionToken: session.rawToken,
      userId: credentials.userId,
    };
  }
}

interface AuthenticateSessionDependencies {
  clock: () => Date;
  repository: SessionRepository;
  sessionTokenHasher: SessionTokenHasher;
}

export class AuthenticateSessionService {
  constructor(private readonly dependencies: AuthenticateSessionDependencies) {}

  async execute(rawToken: string): Promise<AuthenticatedPrincipal> {
    const tokenHash = this.dependencies.sessionTokenHasher.hash(rawToken);
    const session = await this.dependencies.repository.findSessionByTokenHash(tokenHash);
    const now = this.dependencies.clock();

    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= now.getTime()
    ) {
      throw new InvalidSessionError();
    }

    await this.dependencies.repository.touchSession(session.sessionId, now);

    return {
      email: session.email,
      memberships: session.memberships,
      userId: session.userId,
    };
  }
}

interface SignOutDependencies {
  clock: () => Date;
  repository: SessionRepository;
  sessionTokenHasher: SessionTokenHasher;
}

export class SignOutService {
  constructor(private readonly dependencies: SignOutDependencies) {}

  async execute(rawToken: string): Promise<void> {
    const tokenHash = this.dependencies.sessionTokenHasher.hash(rawToken);
    await this.dependencies.repository.revokeSessionByTokenHash(
      tokenHash,
      this.dependencies.clock(),
    );
  }
}

const roleRank: Readonly<Record<TenantRole, number>> = {
  member: 1,
  owner: 2,
};

export function requireTenantRole(
  principal: AuthenticatedPrincipal,
  tenantId: string,
  requiredRole: TenantRole,
): void {
  const membership = principal.memberships.find((item) => item.tenantId === tenantId);

  if (!membership || roleRank[membership.role] < roleRank[requiredRole]) {
    throw new AuthorizationError();
  }
}
