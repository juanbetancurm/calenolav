export type SupportedLocale = "en" | "es";

export interface RegisterOwnerCommand {
  email: string;
  locale: SupportedLocale;
  name: string;
  password: string;
  slug: string;
}

export interface OwnerRegistrationRecord {
  email: string;
  locale: SupportedLocale;
  name: string;
  passwordHash: string;
  sessionExpiresAt: Date;
  sessionTokenHash: string;
  slug: string;
}

export interface OwnerRegistrationIds {
  tenantId: string;
  userId: string;
}

export interface OwnerRegistrationRepository {
  createOwnerRegistration(
    registration: OwnerRegistrationRecord,
  ): Promise<OwnerRegistrationIds>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
}

export interface IssuedSessionToken {
  rawToken: string;
  tokenHash: string;
}

export interface SessionTokenIssuer {
  issue(): IssuedSessionToken;
}

export interface RegisterOwnerResult extends OwnerRegistrationIds {
  email: string;
  expiresAt: Date;
  sessionToken: string;
}

export interface RegisterOwnerDependencies {
  clock: () => Date;
  passwordHasher: PasswordHasher;
  repository: OwnerRegistrationRepository;
  sessionDurationMs: number;
  sessionTokenIssuer: SessionTokenIssuer;
}

export type RegistrationField = "email" | "locale" | "name" | "password" | "slug";

export class RegistrationValidationError extends Error {
  override readonly name = "RegistrationValidationError";

  constructor(
    readonly field: RegistrationField,
    message: string,
  ) {
    super(message);
  }
}

export class RegistrationConflictError extends Error {
  override readonly name = "RegistrationConflictError";

  constructor() {
    super("An account or public slug already uses those details.");
  }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function countCodePoints(value: string): number {
  return [...value].length;
}

function validateAndNormalize(command: RegisterOwnerCommand): RegisterOwnerCommand {
  const email = command.email.trim().toLowerCase();
  if (email.length > 320 || !emailPattern.test(email)) {
    throw new RegistrationValidationError("email", "Enter a valid email address.");
  }

  const name = command.name.trim();
  if (countCodePoints(name) < 1 || countCodePoints(name) > 120) {
    throw new RegistrationValidationError(
      "name",
      "Name must contain between 1 and 120 characters.",
    );
  }

  const passwordLength = countCodePoints(command.password);
  if (passwordLength < 15 || passwordLength > 128) {
    throw new RegistrationValidationError(
      "password",
      "Password must contain between 15 and 128 characters.",
    );
  }

  const slug = command.slug.trim().toLowerCase();
  if (slug.length > 63 || !slugPattern.test(slug)) {
    throw new RegistrationValidationError(
      "slug",
      "Slug must contain lowercase letters, numbers, and single hyphens.",
    );
  }

  if (command.locale !== "es" && command.locale !== "en") {
    throw new RegistrationValidationError("locale", "Locale must be es or en.");
  }

  return { ...command, email, name, slug };
}

export class RegisterOwnerService {
  constructor(private readonly dependencies: RegisterOwnerDependencies) {
    if (
      !Number.isFinite(dependencies.sessionDurationMs) ||
      dependencies.sessionDurationMs <= 0
    ) {
      throw new Error("sessionDurationMs must be a positive finite number.");
    }
  }

  async execute(command: RegisterOwnerCommand): Promise<RegisterOwnerResult> {
    const normalized = validateAndNormalize(command);
    const passwordHash = await this.dependencies.passwordHasher.hash(normalized.password);
    const session = this.dependencies.sessionTokenIssuer.issue();
    const expiresAt = new Date(
      this.dependencies.clock().getTime() + this.dependencies.sessionDurationMs,
    );

    const ids = await this.dependencies.repository.createOwnerRegistration({
      email: normalized.email,
      locale: normalized.locale,
      name: normalized.name,
      passwordHash,
      sessionExpiresAt: expiresAt,
      sessionTokenHash: session.tokenHash,
      slug: normalized.slug,
    });

    return {
      ...ids,
      email: normalized.email,
      expiresAt,
      sessionToken: session.rawToken,
    };
  }
}
