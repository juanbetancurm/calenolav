import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEnvironmentFile, readConfig } from "../src/config.js";
import { PostgresGoogleWatchChannelRepository } from "../src/google/postgres-google-watch-channel-repository.js";

loadEnvironmentFile();
const pool = new Pool({ connectionString: readConfig().databaseUrl });
const createdSlugs: string[] = [];

async function createChannelFixture(input?: { expiresAt?: Date }) {
  const slug = `google-watch-${randomUUID()}`;
  createdSlugs.push(slug);
  const tenant = await pool.query<{ id: string }>(
    "INSERT INTO tenants (name, slug) VALUES ('Google watch test', $1) RETURNING id",
    [slug],
  );
  const tenantId = tenant.rows[0]?.id;
  if (!tenantId) throw new Error("Watch tenant was not created.");
  await pool.query(
    `INSERT INTO google_calendar_connections (
       tenant_id, google_subject, google_account_email, calendar_id,
       refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
       encryption_key_version, granted_scopes
     ) VALUES ($1, 'subject', 'owner@example.com', 'primary',
       'ciphertext', 'abcdefghijklmnop', 'abcdefghijklmnopqrstuv', 1,
       ARRAY['calendar.events'])`,
    [tenantId],
  );
  const channelId = randomUUID();
  await pool.query(
    `INSERT INTO google_calendar_watch_channels (
       channel_id, tenant_id, channel_token_hash, resource_id, expires_at
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      channelId,
      tenantId,
      "a".repeat(64),
      "opaque-google-resource",
      input?.expiresAt ?? new Date("2026-09-08T12:00:00.000Z"),
    ],
  );
  return { channelId, tenantId };
}

beforeAll(async () => {
  await pool.query("SELECT 1");
});

afterEach(async () => {
  await pool.query("DELETE FROM tenants WHERE slug = ANY($1::text[])", [createdSlugs]);
  createdSlugs.length = 0;
});

afterAll(async () => {
  await pool.end();
});

describe.sequential("PostgresGoogleWatchChannelRepository", () => {
  it("atomically records a newer authenticated message without event data", async () => {
    const fixture = await createChannelFixture();
    const repository = new PostgresGoogleWatchChannelRepository(pool);
    const receivedAt = new Date("2026-09-07T12:00:00.000Z");

    await expect(
      repository.recordNotification({
        channelId: fixture.channelId,
        channelTokenHash: "a".repeat(64),
        messageNumber: "42",
        receivedAt,
        resourceId: "opaque-google-resource",
        resourceState: "exists",
      }),
    ).resolves.toBe(true);

    const stored = await pool.query<{
      last_message_number: string;
      last_notification_at: Date;
      last_resource_state: string;
    }>(
      `SELECT last_message_number, last_notification_at, last_resource_state
         FROM google_calendar_watch_channels WHERE channel_id = $1`,
      [fixture.channelId],
    );
    expect(stored.rows[0]).toEqual({
      last_message_number: "42",
      last_notification_at: receivedAt,
      last_resource_state: "exists",
    });
  });

  it("rejects replay, token mismatch, resource mismatch, and expiration", async () => {
    const fixture = await createChannelFixture({
      expiresAt: new Date("2026-09-07T12:00:01.000Z"),
    });
    const repository = new PostgresGoogleWatchChannelRepository(pool);
    const base = {
      channelId: fixture.channelId,
      channelTokenHash: "a".repeat(64),
      messageNumber: "2",
      receivedAt: new Date("2026-09-07T12:00:00.000Z"),
      resourceId: "opaque-google-resource",
      resourceState: "sync" as const,
    };
    await expect(repository.recordNotification(base)).resolves.toBe(true);
    await expect(repository.recordNotification(base)).resolves.toBe(false);
    await expect(
      repository.recordNotification({ ...base, channelTokenHash: "b".repeat(64), messageNumber: "3" }),
    ).resolves.toBe(false);
    await expect(
      repository.recordNotification({ ...base, resourceId: "other-resource", messageNumber: "3" }),
    ).resolves.toBe(false);
    await expect(
      repository.recordNotification({
        ...base,
        messageNumber: "3",
        receivedAt: new Date("2026-09-07T12:00:01.000Z"),
      }),
    ).resolves.toBe(false);
  });
});
