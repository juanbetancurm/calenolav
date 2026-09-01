CREATE TABLE "google_calendar_watch_channels" (
	"channel_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_token_hash" varchar(64) NOT NULL,
	"resource_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_message_number" bigint DEFAULT 0 NOT NULL,
	"last_notification_at" timestamp with time zone,
	"last_resource_state" varchar(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_calendar_watch_channels_token_hash_format" CHECK ("channel_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "google_calendar_watch_channels_resource_not_blank" CHECK (length(trim("resource_id")) > 0),
	CONSTRAINT "google_calendar_watch_channels_message_number_nonnegative" CHECK ("last_message_number" >= 0),
	CONSTRAINT "google_calendar_watch_channels_resource_state" CHECK ("last_resource_state" is null or "last_resource_state" in ('sync', 'exists', 'not_exists')),
	CONSTRAINT "google_calendar_watch_channels_expiry_after_creation" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
ALTER TABLE "google_calendar_watch_channels" ADD CONSTRAINT "google_calendar_watch_channels_tenant_id_google_calendar_connections_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."google_calendar_connections"("tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "google_calendar_watch_channels_tenant_expiry_index" ON "google_calendar_watch_channels" USING btree ("tenant_id","expires_at");