import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ── Better Auth tables (field names per Better Auth drizzle adapter) ─────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role", { enum: ["owner", "member"] })
    .notNull()
    .default("member"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ── App tables ───────────────────────────────────────────────────────────────

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  email: text("email"),
  invitedBy: text("invited_by")
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedByUserId: text("used_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["intervals_icu", "strava"] }).notNull(),
    // AES-256-GCM encrypted (see lib/crypto.ts). For intervals.icu this is the
    // API key; for Strava, access + refresh tokens.
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    externalAthleteId: text("external_athlete_id").notNull(),
    externalAthleteName: text("external_athlete_name"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status", { enum: ["active", "error", "revoked"] })
      .notNull()
      .default("active"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("connections_user_provider_uq").on(t.userId, t.provider)]
);

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // provider doubles as data provenance — Strava rows are excluded from
    // AI-coach/MCP context by default (Strava API AI clause).
    provider: text("provider", {
      enum: ["intervals_icu", "strava", "manual"],
    }).notNull(),
    externalId: text("external_id").notNull(),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    sport: text("sport").notNull(),
    name: text("name"),
    durationS: integer("duration_s"),
    distanceM: real("distance_m"),
    load: real("load"), // TSS-like training load
    avgHr: real("avg_hr"),
    avgPower: real("avg_power"),
    elevationM: real("elevation_m"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("activities_provider_external_uq").on(
      t.userId,
      t.provider,
      t.externalId
    ),
    index("activities_user_start_idx").on(t.userId, t.startDate),
  ]
);

export const activityStreams = pgTable(
  "activity_streams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // time | heartrate | watts | velocity | altitude
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("activity_streams_activity_type_uq").on(t.activityId, t.type),
  ]
);

export const wellnessDaily = pgTable(
  "wellness_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    hrvMs: real("hrv_ms"), // rMSSD
    restingHr: real("resting_hr"),
    sleepSecs: integer("sleep_secs"),
    sleepScore: real("sleep_score"), // 0-100
    ctl: real("ctl"),
    atl: real("atl"),
    eftp: real("eftp"),
    weightKg: real("weight_kg"),
    energy1_10: integer("energy_1_10"),
    soreness1_10: integer("soreness_1_10"),
    stress1_10: integer("stress_1_10"),
    mood: text("mood"),
    tags: jsonb("tags").$type<string[]>(),
    notes: text("notes"),
    source: text("source", { enum: ["intervals_icu", "manual", "strava"] })
      .notNull()
      .default("intervals_icu"),
    raw: jsonb("raw"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("wellness_user_date_uq").on(t.userId, t.date),
    index("wellness_user_date_idx").on(t.userId, t.date),
  ]
);

export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    readiness: real("readiness"), // 0-100; null while calibrating
    band: text("band", { enum: ["green", "amber", "red", "calibrating"] }),
    componentScores: jsonb("component_scores"),
    hrvBaselineMean: real("hrv_baseline_mean"), // mean of ln(hrv), 60d
    hrvBaselineSd: real("hrv_baseline_sd"),
    rhrBaselineMean: real("rhr_baseline_mean"),
    rhrBaselineSd: real("rhr_baseline_sd"),
    tsb: real("tsb"), // CTL − ATL (conventional sign)
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("daily_metrics_user_date_uq").on(t.userId, t.date)]
);

export const chatThreads = pgTable("chat_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    role: text("role", {
      enum: ["user", "assistant", "system", "tool"],
    }).notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("chat_messages_thread_idx").on(t.threadId, t.createdAt)]
);

export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // sha256; plaintext shown once
  lookupPrefix: text("lookup_prefix").notNull(), // first 8 chars of hex hash for fast lookup
  label: text("label").notNull(),
  scopes: text("scopes").notNull().default("read"), // pipe-separated: "read" | "read|write:wellness"
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const llmSettings = pgTable("llm_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  providerType: text("provider_type", {
    enum: ["anthropic", "openai_compatible"],
  }).notNull(),
  baseUrl: text("base_url"), // required for openai_compatible
  encryptedApiKey: text("encrypted_api_key"),
  model: text("model").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["intervals_icu", "strava"] }).notNull(),
    kind: text("kind", { enum: ["backfill", "incremental", "compute_metrics"] })
      .notNull()
      .default("incremental"),
    runAfter: timestamp("run_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text("status", {
      enum: ["pending", "running", "done", "failed"],
    })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sync_jobs_due_idx").on(t.status, t.runAfter)]
);
