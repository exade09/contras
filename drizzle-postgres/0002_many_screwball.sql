CREATE TABLE "payment_profile_access_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"target_user_id" text,
	"action" text DEFAULT 'reveal' NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_profile_access_action_check" CHECK ("payment_profile_access_events"."action" = 'reveal')
);
--> statement-breakpoint
ALTER TABLE "user_payment_profiles" ADD COLUMN "card_pan_encrypted" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_profile_access_events" ADD CONSTRAINT "payment_profile_access_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_profile_access_events" ADD CONSTRAINT "payment_profile_access_events_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_profile_access_actor_idx" ON "payment_profile_access_events" USING btree ("actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payment_profile_access_target_idx" ON "payment_profile_access_events" USING btree ("target_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "user_payment_profiles" ADD CONSTRAINT "user_payment_profiles_card_pan_check" CHECK ("user_payment_profiles"."card_pan_encrypted" = '' or ("user_payment_profiles"."card_last4" <> '' and char_length("user_payment_profiles"."card_pan_encrypted") between 40 and 1024 and "user_payment_profiles"."card_pan_encrypted" ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'));