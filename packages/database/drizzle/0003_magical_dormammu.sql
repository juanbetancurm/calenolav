CREATE EXTENSION IF NOT EXISTS "btree_gist";--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"attendee_name" varchar(120) NOT NULL,
	"attendee_email" varchar(320) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"google_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_attendee_name_not_blank" CHECK (length(trim("bookings"."attendee_name")) > 0),
	CONSTRAINT "bookings_attendee_email_format" CHECK ("bookings"."attendee_email" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
	CONSTRAINT "bookings_interval_positive" CHECK ("bookings"."ends_at" > "bookings"."starts_at"),
	CONSTRAINT "bookings_interval_limit" CHECK ("bookings"."ends_at" <= "bookings"."starts_at" + interval '8 hours'),
	CONSTRAINT "bookings_five_minute_grid" CHECK (mod(extract(epoch from "bookings"."starts_at")::bigint, 300) = 0 and mod(extract(epoch from "bookings"."ends_at")::bigint, 300) = 0),
	CONSTRAINT "bookings_event_state" CHECK (("bookings"."status" = 'confirmed' and "bookings"."google_event_id" is not null and length(trim("bookings"."google_event_id")) > 0) or ("bookings"."status" in ('pending', 'failed') and "bookings"."google_event_id" is null))
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_tenant_idempotency_unique" ON "bookings" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "bookings_tenant_starts_at_index" ON "bookings" USING btree ("tenant_id","starts_at");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_active_interval_exclusion" EXCLUDE USING gist ("tenant_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("status" IN ('pending', 'confirmed'));