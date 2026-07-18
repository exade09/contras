CREATE TABLE "deal_items" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"price_cents" bigint DEFAULT 0 NOT NULL,
	"icon_url" text,
	CONSTRAINT "deal_items_quantity_check" CHECK ("deal_items"."quantity" between 1 and 99),
	CONSTRAINT "deal_items_price_check" CHECK ("deal_items"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"deal_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_amount_check" CHECK ("deals"."amount_cents" >= 0),
	CONSTRAINT "deals_currency_check" CHECK ("deals"."currency" in ('USD', 'EUR', 'RUB')),
	CONSTRAINT "deals_status_check" CHECK ("deals"."status" in ('completed', 'pending', 'cancelled')),
	CONSTRAINT "deals_source_check" CHECK ("deals"."source" in ('manual'))
);
--> statement-breakpoint
CREATE TABLE "login_events" (
	"id" text PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"ip_hash" text NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_expiry_check" CHECK ("sessions"."expires_at" > "sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "steam_auth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"nonce_hash" text NOT NULL,
	"openid_response_nonce_hash" text,
	"intent" text DEFAULT 'login' NOT NULL,
	"return_to" text DEFAULT '/workspace' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "steam_auth_states_intent_check" CHECK ("steam_auth_states"."intent" in ('login', 'link')),
	CONSTRAINT "steam_auth_states_expiry_check" CHECK ("steam_auth_states"."expires_at" > "steam_auth_states"."created_at"),
	CONSTRAINT "steam_auth_states_return_to_check" CHECK ("steam_auth_states"."return_to" like '/%' and "steam_auth_states"."return_to" not like '//%')
);
--> statement-breakpoint
CREATE TABLE "steam_links" (
	"user_id" text PRIMARY KEY NOT NULL,
	"steam_id" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"profile_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "steam_links_steam_id_check" CHECK ("steam_links"."steam_id" ~ '^[0-9]{17}$')
);
--> statement-breakpoint
CREATE TABLE "trade_request_items" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"asset_id" text,
	"class_id" text,
	"instance_id" text,
	"app_id" integer DEFAULT 730 NOT NULL,
	"context_id" text DEFAULT '2' NOT NULL,
	"catalog_id" text,
	"market_hash_name" text,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"icon_url" text,
	"inspect_link" text,
	"item_type" text,
	"weapon" text,
	"category" text,
	"rarity" text,
	"rarity_color" text,
	"wear" text,
	"collection" text,
	"tradable" boolean DEFAULT false NOT NULL,
	"marketable" boolean DEFAULT false NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_request_items_asset_id_check" CHECK ("trade_request_items"."asset_id" is null or "trade_request_items"."asset_id" ~ '^[0-9]{1,40}$'),
	CONSTRAINT "trade_request_items_quantity_check" CHECK ("trade_request_items"."quantity" between 1 and 100),
	CONSTRAINT "trade_request_items_rarity_color_check" CHECK ("trade_request_items"."rarity_color" is null or "trade_request_items"."rarity_color" ~ '^[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "trade_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"steam_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_requests_steam_id_check" CHECK ("trade_requests"."steam_id" ~ '^[0-9]{17}$'),
	CONSTRAINT "trade_requests_amount_check" CHECK ("trade_requests"."amount_cents" > 0),
	CONSTRAINT "trade_requests_currency_check" CHECK ("trade_requests"."currency" in ('USD', 'EUR', 'RUB')),
	CONSTRAINT "trade_requests_status_check" CHECK ("trade_requests"."status" in ('pending', 'contacted', 'accepted', 'rejected', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text,
	"password_salt" text,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"steam_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_login_length_check" CHECK (char_length("users"."login") between 3 and 64),
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin', 'user')),
	CONSTRAINT "users_status_check" CHECK ("users"."status" in ('active', 'blocked')),
	CONSTRAINT "users_password_pair_check" CHECK (("users"."password_hash" is null) = ("users"."password_salt" is null)),
	CONSTRAINT "users_legacy_steam_id_check" CHECK ("users"."steam_id" is null or "users"."steam_id" ~ '^[0-9]{17}$')
);
--> statement-breakpoint
ALTER TABLE "deal_items" ADD CONSTRAINT "deal_items_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam_auth_states" ADD CONSTRAINT "steam_auth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam_links" ADD CONSTRAINT "steam_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_request_items" ADD CONSTRAINT "trade_request_items_request_id_trade_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."trade_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_requests" ADD CONSTRAINT "trade_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_items_deal_idx" ON "deal_items" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "deals_user_date_idx" ON "deals" USING btree ("user_id","deal_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deals_created_by_idx" ON "deals" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "login_events_lookup_idx" ON "login_events" USING btree ("login","ip_hash","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "steam_auth_states_expiry_idx" ON "steam_auth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "steam_auth_states_user_idx" ON "steam_auth_states" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "steam_auth_states_nonce_unique" ON "steam_auth_states" USING btree ("nonce_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "steam_auth_states_response_nonce_unique" ON "steam_auth_states" USING btree ("openid_response_nonce_hash") WHERE "steam_auth_states"."openid_response_nonce_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "steam_links_steam_id_unique" ON "steam_links" USING btree ("steam_id");--> statement-breakpoint
CREATE INDEX "trade_request_items_request_idx" ON "trade_request_items" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_request_items_request_asset_unique" ON "trade_request_items" USING btree ("request_id","asset_id") WHERE "trade_request_items"."asset_id" is not null;--> statement-breakpoint
CREATE INDEX "trade_requests_user_created_idx" ON "trade_requests" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trade_requests_status_created_idx" ON "trade_requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "users_login_unique" ON "users" USING btree ("login");--> statement-breakpoint
CREATE INDEX "users_steam_id_legacy_idx" ON "users" USING btree ("steam_id");
