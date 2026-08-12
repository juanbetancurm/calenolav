import type { Pool, PoolClient } from "pg";
import {
  RegistrationConflictError,
  type OwnerRegistrationIds,
  type OwnerRegistrationRecord,
  type OwnerRegistrationRepository,
} from "./register-owner.js";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

async function insertRegistration(
  client: PoolClient,
  registration: OwnerRegistrationRecord,
): Promise<OwnerRegistrationIds> {
  const user = await client.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, locale)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [registration.email, registration.passwordHash, registration.locale],
  );
  const userId = user.rows[0]?.id;
  if (!userId) {
    throw new Error("User insert did not return an id.");
  }

  const tenant = await client.query<{ id: string }>(
    `INSERT INTO tenants (name, slug)
     VALUES ($1, $2)
     RETURNING id`,
    [registration.name, registration.slug],
  );
  const tenantId = tenant.rows[0]?.id;
  if (!tenantId) {
    throw new Error("Tenant insert did not return an id.");
  }

  await client.query(
    `INSERT INTO tenant_memberships (tenant_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [tenantId, userId],
  );
  await client.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, registration.sessionTokenHash, registration.sessionExpiresAt],
  );

  return { tenantId, userId };
}

export class PostgresOwnerRegistrationRepository
  implements OwnerRegistrationRepository
{
  constructor(private readonly pool: Pool) {}

  async createOwnerRegistration(
    registration: OwnerRegistrationRecord,
  ): Promise<OwnerRegistrationIds> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ids = await insertRegistration(client, registration);
      await client.query("COMMIT");
      return ids;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (isUniqueViolation(error)) {
        throw new RegistrationConflictError();
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
