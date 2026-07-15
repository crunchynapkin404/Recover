import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Relative, not "@/": drizzle-kit loads this file outside the Next resolver.
import type { DescriptionFields } from "../strava-description-fields";

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
    provider: text("provider", {
      enum: ["intervals_icu", "strava", "google_calendar"],
    }).notNull(),
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
    // v0.6: true only when the OAuth grant includes activity:write
    // (Strava description write-back). Flipped false on write auth failures.
    stravaWriteEnabled: boolean("strava_write_enabled")
      .notNull()
      .default(false),
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
  // System threads: 'morning' holds the daily proactive coach insight.
  kind: text("kind", { enum: ["chat", "morning", "weekly"] })
    .notNull()
    .default("chat"),
  // Ghost threads: auto-purged by the scheduler 24h after last activity.
  ephemeral: boolean("ephemeral").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const coachMemories = pgTable(
  "coach_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category", {
      enum: ["goal", "injury", "race", "preference", "fact"],
    }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("coach_memories_user_idx").on(t.userId)]
);

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
  // Thinking modes: per-message quick/deep model slots; `model` stays as
  // the legacy fallback (mirrors modelDeep on save).
  modelQuick: text("model_quick"),
  modelDeep: text("model_deep"),
  defaultMode: text("default_mode", { enum: ["quick", "deep"] })
    .notNull()
    .default("deep"),
  coachPersonality: text("coach_personality", {
    enum: ["analytical", "encouraging", "direct"],
  })
    .notNull()
    .default("encouraging"),
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

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const notificationPrefs = pgTable("notification_prefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  morningPushEnabled: boolean("morning_push_enabled").notNull().default(true),
  lastMorningPushDate: date("last_morning_push_date"),
  weeklyReviewDay: smallint("weekly_review_day").notNull().default(1), // 0=Sun..6=Sat, default Monday
  weeklyReviewHour: smallint("weekly_review_hour").notNull().default(7), // 0-23, default 7am
  // v0.6: opt-in Strava auto-describe (write-back of intervals.icu metrics).
  autoDescribeStrava: boolean("auto_describe_strava").notNull().default(false),
  // v0.6.1: null = every field (v0.6 output); object = explicit allowlist.
  stravaDescriptionFields: jsonb(
    "strava_description_fields"
  ).$type<DescriptionFields>(),
});

// Instance-level key/value config (e.g. auto-generated VAPID keys; secret
// values stored encrypted via lib/crypto).
export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * v0.4c — cached athlete-level curves/best-efforts fetched precomputed from
 * intervals.icu (6 h TTL in src/lib/athlete-curves.ts; stale-if-error).
 * `params` is the canonicalized query string, e.g. "days=90".
 */
export const athleteCurves = pgTable(
  "athlete_curves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["power", "pace", "best_efforts"] }).notNull(),
    params: text("params").notNull(),
    data: jsonb("data").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("athlete_curves_user_kind_params_uq").on(
      t.userId,
      t.kind,
      t.params
    ),
  ]
);

// ── v0.5d Training Plan Generation ──────────────────────────────────────────

export const trainingPlans = pgTable(
  "training_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    raceType: text("race_type").notNull(),
    raceDate: date("race_date").notNull(),
    startDate: date("start_date").notNull(),
    weeksTotal: smallint("weeks_total").notNull(),
    currentWeek: smallint("current_week").notNull().default(1),
    targetCtl: real("target_ctl"),
    startingCtl: real("starting_ctl"),
    status: text("status", { enum: ["active", "completed", "archived"] })
      .notNull()
      .default("active"),
    constraints: jsonb("constraints"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("training_plans_user_status_idx").on(t.userId, t.status)]
);

export const trainingBlocks = pgTable(
  "training_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => trainingPlans.id, { onDelete: "cascade" }),
    weekNumber: smallint("week_number").notNull(),
    phase: text("phase", {
      enum: ["base", "build", "peak", "taper", "recovery"],
    }).notNull(),
    targetLoadTotal: real("target_load_total"),
    targetSessions: smallint("target_sessions"),
    workouts: jsonb("workouts").notNull(),
    actualLoad: real("actual_load"),
    actualSessions: smallint("actual_sessions"),
    adherencePct: real("adherence_pct"),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("training_blocks_plan_week_uq").on(t.planId, t.weekNumber),
  ]
);
