CREATE TABLE "google_calendar_connections" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"google_subject" varchar(255) NOT NULL,
	"google_account_email" varchar(320) NOT NULL,
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"refresh_token_ciphertext" text NOT NULL,
	"refresh_token_iv" varchar(16) NOT NULL,
	"refresh_token_auth_tag" varchar(22) NOT NULL,
	"encryption_key_version" integer NOT NULL,
	"granted_scopes" text[] NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_calendar_connections_subject_not_blank" CHECK (length(trim("google_calendar_connections"."google_subject")) > 0),
	CONSTRAINT "google_calendar_connections_email_not_blank" CHECK (length(trim("google_calendar_connections"."google_account_email")) > 3),
	CONSTRAINT "google_calendar_connections_calendar_not_blank" CHECK (length(trim("google_calendar_connections"."calendar_id")) > 0),
	CONSTRAINT "google_calendar_connections_ciphertext_not_blank" CHECK (length("google_calendar_connections"."refresh_token_ciphertext") > 0),
	CONSTRAINT "google_calendar_connections_iv_format" CHECK ("google_calendar_connections"."refresh_token_iv" ~ '^[A-Za-z0-9_-]{16}$'),
	CONSTRAINT "google_calendar_connections_auth_tag_format" CHECK ("google_calendar_connections"."refresh_token_auth_tag" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "google_calendar_connections_key_version_positive" CHECK ("google_calendar_connections"."encryption_key_version" > 0),
	CONSTRAINT "google_calendar_connections_scopes_not_empty" CHECK (cardinality("google_calendar_connections"."granted_scopes") > 0)
);
--> statement-breakpoint
CREATE TABLE "google_oauth_attempts" (
	"state_hash" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code_verifier_ciphertext" text NOT NULL,
	"code_verifier_iv" varchar(16) NOT NULL,
	"code_verifier_auth_tag" varchar(22) NOT NULL,
	"encryption_key_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_oauth_attempts_state_hash_format" CHECK ("google_oauth_attempts"."state_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "google_oauth_attempts_ciphertext_not_blank" CHECK (length("google_oauth_attempts"."code_verifier_ciphertext") > 0),
	CONSTRAINT "google_oauth_attempts_iv_format" CHECK ("google_oauth_attempts"."code_verifier_iv" ~ '^[A-Za-z0-9_-]{16}$'),
	CONSTRAINT "google_oauth_attempts_auth_tag_format" CHECK ("google_oauth_attempts"."code_verifier_auth_tag" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "google_oauth_attempts_key_version_positive" CHECK ("google_oauth_attempts"."encryption_key_version" > 0),
	CONSTRAINT "google_oauth_attempts_expiry_after_creation" CHECK ("google_oauth_attempts"."expires_at" > "google_oauth_attempts"."created_at")
);
--> statement-breakpoint
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_oauth_attempts" ADD CONSTRAINT "google_oauth_attempts_membership_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "google_calendar_connections_subject_index" ON "google_calendar_connections" USING btree ("google_subject");--> statement-breakpoint
CREATE INDEX "google_oauth_attempts_membership_index" ON "google_oauth_attempts" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "google_oauth_attempts_expires_at_index" ON "google_oauth_attempts" USING btree ("expires_at");