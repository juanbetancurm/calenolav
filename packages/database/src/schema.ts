import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const tenantRole = pgEnum("tenant_role", ["owner", "member"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    locale: varchar("locale", { length: 5 }).default("es").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`),
    check("users_email_not_blank", sql`length(trim(${table.email})) > 3`),
    check("users_locale_supported", sql`${table.locale} in ('es', 'en')`),
  ],
);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 63 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("tenants_slug_unique").on(table.slug),
    check("tenants_name_not_blank", sql`length(trim(${table.name})) > 0`),
    check(
      "tenants_slug_format",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
  ],
);

export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: tenantRole("role").default("member").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId] }),
    index("tenant_memberships_user_id_index").on(table.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_index").on(table.userId),
    index("sessions_expires_at_index").on(table.expiresAt),
  ],
);

export const googleCalendarConnections = pgTable(
  "google_calendar_connections",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    googleSubject: varchar("google_subject", { length: 255 }).notNull(),
    googleAccountEmail: varchar("google_account_email", { length: 320 }).notNull(),
    calendarId: text("calendar_id").default("primary").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
    refreshTokenIv: varchar("refresh_token_iv", { length: 16 }).notNull(),
    refreshTokenAuthTag: varchar("refresh_token_auth_tag", { length: 22 }).notNull(),
    encryptionKeyVersion: integer("encryption_key_version").notNull(),
    grantedScopes: text("granted_scopes").array().notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("google_calendar_connections_subject_index").on(table.googleSubject),
    check(
      "google_calendar_connections_subject_not_blank",
      sql`length(trim(${table.googleSubject})) > 0`,
    ),
    check(
      "google_calendar_connections_email_not_blank",
      sql`length(trim(${table.googleAccountEmail})) > 3`,
    ),
    check(
      "google_calendar_connections_calendar_not_blank",
      sql`length(trim(${table.calendarId})) > 0`,
    ),
    check(
      "google_calendar_connections_ciphertext_not_blank",
      sql`length(${table.refreshTokenCiphertext}) > 0`,
    ),
    check(
      "google_calendar_connections_iv_format",
      sql`${table.refreshTokenIv} ~ '^[A-Za-z0-9_-]{16}$'`,
    ),
    check(
      "google_calendar_connections_auth_tag_format",
      sql`${table.refreshTokenAuthTag} ~ '^[A-Za-z0-9_-]{22}$'`,
    ),
    check(
      "google_calendar_connections_key_version_positive",
      sql`${table.encryptionKeyVersion} > 0`,
    ),
    check(
      "google_calendar_connections_scopes_not_empty",
      sql`cardinality(${table.grantedScopes}) > 0`,
    ),
  ],
);

export const googleOauthAttempts = pgTable(
  "google_oauth_attempts",
  {
    stateHash: varchar("state_hash", { length: 64 }).primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    codeVerifierCiphertext: text("code_verifier_ciphertext").notNull(),
    codeVerifierIv: varchar("code_verifier_iv", { length: 16 }).notNull(),
    codeVerifierAuthTag: varchar("code_verifier_auth_tag", { length: 22 }).notNull(),
    encryptionKeyVersion: integer("encryption_key_version").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: "google_oauth_attempts_membership_fk",
    }).onDelete("cascade"),
    index("google_oauth_attempts_membership_index").on(table.tenantId, table.userId),
    index("google_oauth_attempts_expires_at_index").on(table.expiresAt),
    check(
      "google_oauth_attempts_state_hash_format",
      sql`${table.stateHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "google_oauth_attempts_ciphertext_not_blank",
      sql`length(${table.codeVerifierCiphertext}) > 0`,
    ),
    check(
      "google_oauth_attempts_iv_format",
      sql`${table.codeVerifierIv} ~ '^[A-Za-z0-9_-]{16}$'`,
    ),
    check(
      "google_oauth_attempts_auth_tag_format",
      sql`${table.codeVerifierAuthTag} ~ '^[A-Za-z0-9_-]{22}$'`,
    ),
    check(
      "google_oauth_attempts_key_version_positive",
      sql`${table.encryptionKeyVersion} > 0`,
    ),
    check(
      "google_oauth_attempts_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type GoogleCalendarConnection = typeof googleCalendarConnections.$inferSelect;
export type NewGoogleCalendarConnection = typeof googleCalendarConnections.$inferInsert;
export type GoogleOauthAttempt = typeof googleOauthAttempts.$inferSelect;
export type NewGoogleOauthAttempt = typeof googleOauthAttempts.$inferInsert;
