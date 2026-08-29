CREATE TABLE "availability_policies" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"time_zone" varchar(100) NOT NULL,
	"slot_duration_minutes" integer NOT NULL,
	"minimum_notice_minutes" integer NOT NULL,
	"booking_window_days" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_policies_time_zone_not_blank" CHECK (length(trim("availability_policies"."time_zone")) > 0),
	CONSTRAINT "availability_policies_slot_duration_limits" CHECK ("availability_policies"."slot_duration_minutes" between 5 and 480 and "availability_policies"."slot_duration_minutes" % 5 = 0),
	CONSTRAINT "availability_policies_minimum_notice_limits" CHECK ("availability_policies"."minimum_notice_minutes" between 0 and 43200 and "availability_policies"."minimum_notice_minutes" % 5 = 0),
	CONSTRAINT "availability_policies_booking_window_limits" CHECK ("availability_policies"."booking_window_days" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "weekly_availability_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_availability_windows_weekday_limits" CHECK ("weekly_availability_windows"."weekday" between 1 and 7),
	CONSTRAINT "weekly_availability_windows_start_minute_limits" CHECK ("weekly_availability_windows"."start_minute" between 0 and 1439 and "weekly_availability_windows"."start_minute" % 5 = 0),
	CONSTRAINT "weekly_availability_windows_end_minute_limits" CHECK ("weekly_availability_windows"."end_minute" between 1 and 1440 and "weekly_availability_windows"."end_minute" % 5 = 0),
	CONSTRAINT "weekly_availability_windows_positive_duration" CHECK ("weekly_availability_windows"."end_minute" > "weekly_availability_windows"."start_minute")
);
--> statement-breakpoint
ALTER TABLE "availability_policies" ADD CONSTRAINT "availability_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_availability_windows" ADD CONSTRAINT "weekly_availability_windows_tenant_id_availability_policies_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."availability_policies"("tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_availability_windows_exact_unique" ON "weekly_availability_windows" USING btree ("tenant_id","weekday","start_minute","end_minute");--> statement-breakpoint
CREATE INDEX "weekly_availability_windows_tenant_weekday_index" ON "weekly_availability_windows" USING btree ("tenant_id","weekday","start_minute");