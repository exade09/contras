CREATE TABLE "user_payment_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"method" text DEFAULT 'kaspi_card' NOT NULL,
	"recipient_name" text NOT NULL,
	"kaspi_phone" text DEFAULT '' NOT NULL,
	"card_last4" text DEFAULT '' NOT NULL,
	"updated_by_role" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_payment_profiles_method_check" CHECK ("user_payment_profiles"."method" = 'kaspi_card'),
	CONSTRAINT "user_payment_profiles_recipient_name_check" CHECK (char_length("user_payment_profiles"."recipient_name") between 1 and 80),
	CONSTRAINT "user_payment_profiles_kaspi_phone_check" CHECK ("user_payment_profiles"."kaspi_phone" = '' or "user_payment_profiles"."kaspi_phone" ~ '^\+7[0-9]{10}$'),
	CONSTRAINT "user_payment_profiles_card_last4_check" CHECK ("user_payment_profiles"."card_last4" = '' or "user_payment_profiles"."card_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "user_payment_profiles_reference_check" CHECK ("user_payment_profiles"."kaspi_phone" <> '' or "user_payment_profiles"."card_last4" <> ''),
	CONSTRAINT "user_payment_profiles_updated_by_role_check" CHECK ("user_payment_profiles"."updated_by_role" in ('user', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "user_payment_profiles" ADD CONSTRAINT "user_payment_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
