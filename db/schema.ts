import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SaleItemSnapshot = { [key: string]: JsonValue };

const timestampColumn = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "string" });

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    login: text("login").notNull(),
    displayName: text("display_name").notNull(),
    // Steam-created accounts do not have local password credentials.
    passwordHash: text("password_hash"),
    passwordSalt: text("password_salt"),
    role: text("role").notNull().default("user"),
    status: text("status").notNull().default("active"),
    // Kept during the D1 cutover. steam_links is authoritative for new writes.
    steamId: text("steam_id"),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
    updatedAt: timestampColumn("updated_at").notNull().defaultNow(),
    lastLoginAt: timestampColumn("last_login_at"),
  },
  (table) => [
    uniqueIndex("users_login_unique").on(table.login),
    index("users_steam_id_legacy_idx").on(table.steamId),
    check("users_login_length_check", sql`char_length(${table.login}) between 3 and 64`),
    check("users_role_check", sql`${table.role} in ('admin', 'user')`),
    check("users_status_check", sql`${table.status} in ('active', 'blocked')`),
    check(
      "users_password_pair_check",
      sql`(${table.passwordHash} is null) = (${table.passwordSalt} is null)`,
    ),
    check(
      "users_legacy_steam_id_check",
      sql`${table.steamId} is null or ${table.steamId} ~ '^[0-9]{17}$'`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestampColumn("expires_at").notNull(),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("sessions_expiry_idx").on(table.expiresAt),
    index("sessions_user_idx").on(table.userId),
    check("sessions_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const deals = pgTable(
  "deals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    dealDate: date("deal_date", { mode: "string" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("completed"),
    source: text("source").notNull().default("manual"),
    note: text("note").notNull().default(""),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("deals_user_date_idx").on(table.userId, table.dealDate.desc()),
    index("deals_created_by_idx").on(table.createdBy),
    check("deals_amount_check", sql`${table.amountCents} >= 0`),
    check("deals_currency_check", sql`${table.currency} in ('USD', 'EUR', 'RUB')`),
    check("deals_status_check", sql`${table.status} in ('completed', 'pending', 'cancelled')`),
    check("deals_source_check", sql`${table.source} in ('manual')`),
  ],
);

export const dealItems = pgTable(
  "deal_items",
  {
    id: text("id").primaryKey(),
    dealId: text("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    priceCents: bigint("price_cents", { mode: "number" }).notNull().default(0),
    iconUrl: text("icon_url"),
  },
  (table) => [
    index("deal_items_deal_idx").on(table.dealId),
    check("deal_items_quantity_check", sql`${table.quantity} between 1 and 99`),
    check("deal_items_price_check", sql`${table.priceCents} >= 0`),
  ],
);

export const steamAuthStates = pgTable(
  "steam_auth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    // Null for a first-time public Steam sign-in; populated for account linking.
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    nonceHash: text("nonce_hash").notNull(),
    openIdResponseNonceHash: text("openid_response_nonce_hash"),
    intent: text("intent").notNull().default("login"),
    returnTo: text("return_to").notNull().default("/workspace"),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
    expiresAt: timestampColumn("expires_at").notNull(),
    consumedAt: timestampColumn("consumed_at"),
  },
  (table) => [
    index("steam_auth_states_expiry_idx").on(table.expiresAt),
    index("steam_auth_states_user_idx").on(table.userId),
    uniqueIndex("steam_auth_states_nonce_unique").on(table.nonceHash),
    uniqueIndex("steam_auth_states_response_nonce_unique")
      .on(table.openIdResponseNonceHash)
      .where(sql`${table.openIdResponseNonceHash} is not null`),
    check("steam_auth_states_intent_check", sql`${table.intent} in ('login', 'link')`),
    check("steam_auth_states_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check("steam_auth_states_return_to_check", sql`${table.returnTo} like '/%' and ${table.returnTo} not like '//%'`),
  ],
);

export const steamLinks = pgTable(
  "steam_links",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    steamId: text("steam_id").notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    profileUrl: text("profile_url"),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
    updatedAt: timestampColumn("updated_at").notNull().defaultNow(),
    verifiedAt: timestampColumn("verified_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("steam_links_steam_id_unique").on(table.steamId),
    check("steam_links_steam_id_check", sql`${table.steamId} ~ '^[0-9]{17}$'`),
  ],
);

export const loginEvents = pgTable(
  "login_events",
  {
    id: text("id").primaryKey(),
    login: text("login").notNull(),
    ipHash: text("ip_hash").notNull(),
    success: boolean("success").notNull().default(false),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("login_events_lookup_idx").on(
      table.login,
      table.ipHash,
      table.createdAt.desc(),
    ),
  ],
);

export const tradeRequests = pgTable(
  "trade_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    steamId: text("steam_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("pending"),
    note: text("note").notNull().default(""),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
    updatedAt: timestampColumn("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("trade_requests_user_created_idx").on(table.userId, table.createdAt.desc()),
    index("trade_requests_status_created_idx").on(table.status, table.createdAt.desc()),
    check("trade_requests_steam_id_check", sql`${table.steamId} ~ '^[0-9]{17}$'`),
    check("trade_requests_amount_check", sql`${table.amountCents} > 0`),
    check("trade_requests_currency_check", sql`${table.currency} in ('USD', 'EUR', 'RUB')`),
    check(
      "trade_requests_status_check",
      sql`${table.status} in ('pending', 'contacted', 'accepted', 'rejected', 'completed', 'cancelled')`,
    ),
  ],
);

export const tradeRequestItems = pgTable(
  "trade_request_items",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => tradeRequests.id, { onDelete: "cascade" }),
    // Nullable only so legacy manual D1 rows can be imported. New requests must
    // always persist the verified owned Steam asset id.
    assetId: text("asset_id"),
    classId: text("class_id"),
    instanceId: text("instance_id"),
    appId: integer("app_id").notNull().default(730),
    contextId: text("context_id").notNull().default("2"),
    catalogId: text("catalog_id"),
    marketHashName: text("market_hash_name"),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    iconUrl: text("icon_url"),
    inspectLink: text("inspect_link"),
    itemType: text("item_type"),
    weapon: text("weapon"),
    category: text("category"),
    rarity: text("rarity"),
    rarityColor: text("rarity_color"),
    wear: text("wear"),
    collection: text("collection"),
    tradable: boolean("tradable").notNull().default(false),
    marketable: boolean("marketable").notNull().default(false),
    snapshot: jsonb("snapshot")
      .$type<SaleItemSnapshot>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("trade_request_items_request_idx").on(table.requestId),
    uniqueIndex("trade_request_items_request_asset_unique")
      .on(table.requestId, table.assetId)
      .where(sql`${table.assetId} is not null`),
    check(
      "trade_request_items_asset_id_check",
      sql`${table.assetId} is null or ${table.assetId} ~ '^[0-9]{1,40}$'`,
    ),
    check("trade_request_items_quantity_check", sql`${table.quantity} between 1 and 100`),
    check(
      "trade_request_items_rarity_color_check",
      sql`${table.rarityColor} is null or ${table.rarityColor} ~ '^[0-9A-Fa-f]{6}$'`,
    ),
  ],
);
