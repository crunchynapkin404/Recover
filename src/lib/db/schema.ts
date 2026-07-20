import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  boolean,
  customType,
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
import type { DayFlag } from "../day-flags";

/** Postgres tsvector — drizzle has no built-in type (v0.15 recall FTS). */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

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
      enum: [
        "intervals_icu",
        "strava",
        "google_calendar",
        "whoop",
        "oura",
        "withings",
        "apple_health",
      ],
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
    // v0.15: activity-poll cursor — set every poll attempt, success or not.
    lastActivityPollAt: timestamp("last_activity_poll_at", {
      withTimezone: true,
    }),
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
    // v0.15 post-ride loop. debriefState null = never eligible (pre-v0.15
    // rows and historical imports get no retroactive prompts).
    perceivedExertion: real("perceived_exertion"),
    feel: text("feel", { enum: ["strong", "normal", "weak"] }),
    debriefNotes: text("debrief_notes"),
    debriefState: text("debrief_state", {
      enum: ["pending", "answered", "skipped", "expired"],
    }),
    debriefThreadId: uuid("debrief_thread_id").references(
      () => chatThreads.id,
      {
        onDelete: "set null",
      }
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewAttempts: integer("review_attempts").notNull().default(0),
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
    index("activities_user_debrief_idx").on(t.userId, t.debriefState),
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
    // v0.11 wearables: staged sleep + bed window (the data v0.9.0 had to
    // delete cards for), plus vitals the new providers measure.
    sleepDeepSecs: integer("sleep_deep_secs"),
    sleepRemSecs: integer("sleep_rem_secs"),
    sleepLightSecs: integer("sleep_light_secs"),
    sleepAwakeSecs: integer("sleep_awake_secs"),
    bedStart: timestamp("bed_start", { withTimezone: true }),
    bedEnd: timestamp("bed_end", { withTimezone: true }),
    tempDeviationC: real("temp_deviation_c"),
    respiratoryRate: real("respiratory_rate"),
    systolic: real("systolic"),
    diastolic: real("diastolic"),
    bodyFatPct: real("body_fat_pct"),
    ctl: real("ctl"),
    atl: real("atl"),
    eftp: real("eftp"),
    weightKg: real("weight_kg"),
    energy1_10: integer("energy_1_10"),
    soreness1_10: integer("soreness_1_10"),
    stress1_10: integer("stress_1_10"),
    mood: text("mood"),
    tags: jsonb("tags").$type<string[]>(),
    // Facts that invalidate the day as a baseline reference (ill/travel/
    // altitude). null and [] both mean "a normal day". See lib/day-flags.ts.
    dayFlags: jsonb("day_flags").$type<DayFlag[]>(),
    notes: text("notes"),
    // v0.15 recall FTS over journal notes (see chatMessages.search).
    search: tsvector("search").generatedAlwaysAs(
      (): SQL => sql`to_tsvector('simple', coalesce(notes, ''))`
    ),
    source: text("source", {
      enum: [
        "intervals_icu",
        "manual",
        "strava",
        "whoop",
        "oura",
        "withings",
        "apple_health",
      ],
    })
      .notNull()
      .default("intervals_icu"),
    // v0.11: per-field provenance — which source owns each populated field.
    // null on legacy rows (every field then belongs to `source`).
    fieldSources: jsonb("field_sources").$type<Record<string, string>>(),
    raw: jsonb("raw"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("wellness_user_date_uq").on(t.userId, t.date),
    index("wellness_user_date_idx").on(t.userId, t.date),
    index("wellness_search_idx").using("gin", t.search),
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
    // v0.10 Honest Load: effective training-load state for the day.
    // Provider (intervals.icu) values win; the native engine fills gaps.
    ctl: real("ctl"),
    atl: real("atl"),
    loadSource: text("load_source", { enum: ["provider", "computed"] }),
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
  kind: text("kind", {
    enum: ["chat", "morning", "weekly", "debrief", "monthly"],
  })
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
    // v0.15 recall FTS. 'simple' config: mixed Dutch/English conversations —
    // language stemming would mangle one of them; exact tokens are never wrong.
    search: tsvector("search").generatedAlwaysAs(
      (): SQL => sql`to_tsvector('simple', coalesce(content, ''))`
    ),
  },
  (t) => [
    index("chat_messages_thread_idx").on(t.threadId, t.createdAt),
    index("chat_messages_search_idx").using("gin", t.search),
  ]
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
    provider: text("provider", {
      enum: ["intervals_icu", "strava", "whoop", "oura", "withings"],
    }).notNull(),
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
  // v0.6.2: null = every field (v0.6 output); object = explicit allowlist.
  stravaDescriptionFields: jsonb(
    "strava_description_fields"
  ).$type<DescriptionFields>(),
  // v0.15 post-ride loop: the loop's kill switch, and its opt-in push.
  rideDebriefsEnabled: boolean("ride_debriefs_enabled").notNull().default(true),
  debriefPushEnabled: boolean("debrief_push_enabled").notNull().default(false),
});

/**
 * v0.9.0 — per-user body/sleep preferences.
 *
 * Separate from notificationPrefs, which has drifted into a junk drawer
 * (autoDescribeStrava lives there). These are not notifications.
 */
export const bodyPrefs = pgTable("body_prefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  // null = not set. Deliberately no default: a guessed wake time would put an
  // invented bedtime on the dashboard, which is what v0.9.0 removes.
  wakeTime: text("wake_time"), // "HH:MM" local
  sleepNeedSecs: integer("sleep_need_secs").notNull().default(28800), // 8h
  // v0.10 Honest Load: athlete thresholds for the native load engine.
  // null = not set; the engine degrades to its duration fallback.
  maxHr: integer("max_hr"),
  ftpWatts: integer("ftp_watts"),
  // v0.13 Deep Biology: enables the biological-age estimate. null = not set
  // (bio-age reports "insufficient inputs" listing this among what's missing).
  birthYear: integer("birth_year"),
});

/**
 * v0.13 Deep Biology — extracted/entered blood biomarkers. Nothing lands
 * here unconfirmed: LLM-extracted rows carry a per-value `confidence` and
 * pass a human review screen before insert.
 */
export const biomarkers = pgTable(
  "biomarkers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // canonical slug, e.g. ldl_cholesterol
    displayName: text("display_name").notNull(),
    category: text("category", {
      enum: [
        "lipids",
        "metabolic",
        "hematology",
        "hormones",
        "vitamins",
        "organ",
        "other",
      ],
    })
      .notNull()
      .default("other"),
    value: real("value").notNull(),
    unit: text("unit"),
    measuredAt: date("measured_at").notNull(),
    source: text("source", {
      enum: ["blood_test", "manual", "withings"],
    }).notNull(),
    // 0-1 for LLM-extracted values; null for manual entry.
    confidence: real("confidence"),
    rawLabel: text("raw_label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("biomarkers_user_name_date_uq").on(
      t.userId,
      t.name,
      t.measuredAt
    ),
    index("biomarkers_user_name_idx").on(t.userId, t.name),
  ]
);

// ── v0.15 The Coach Remembers ───────────────────────────────────────────────

/** One row per LLM call. Tokens, never cost estimates (BYO endpoints make
 * pricing unknowable). Providers that omit usage produce no row at all. */
export const llmUsage = pgTable(
  "llm_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    slot: text("slot", { enum: ["quick", "deep"] }).notNull(),
    purpose: text("purpose", {
      enum: [
        "chat",
        "morning",
        "weekly",
        "monthly",
        "ride_review",
        "race_debrief",
        "health_extract",
      ],
    }).notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("llm_usage_user_created_idx").on(t.userId, t.createdAt)]
);

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
    raceId: uuid("race_id").references(() => races.id, {
      onDelete: "set null",
    }),
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

// ── v0.14 Race Ready ────────────────────────────────────────────────────────

export const races = pgTable(
  "races",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    raceType: text("race_type").notNull(),
    sport: text("sport"),
    date: date("date").notNull(),
    priority: text("priority", { enum: ["A", "B", "C"] }).notNull(),
    status: text("status", { enum: ["upcoming", "completed", "skipped"] })
      .notNull()
      .default("upcoming"),
    goalNote: text("goal_note"),
    resultActivityId: uuid("result_activity_id").references(
      () => activities.id,
      { onDelete: "set null" }
    ),
    debriefedAt: timestamp("debriefed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("races_user_date_name_uq").on(t.userId, t.date, t.name),
    index("races_user_status_date_idx").on(t.userId, t.status, t.date),
  ]
);

// ── v0.9.2 Adaptive Week ─────────────────────────────────────────────────────

export const weekPlans = pgTable(
  "week_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => trainingPlans.id, { onDelete: "cascade" }),
    weekStart: date("week_start").notNull(),
    skeletonWeek: smallint("skeleton_week").notNull(),
    days: jsonb("days").notNull(),
    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    // v0.14 Race Ready fix: materializeWeek's effectiveLoad (post-taper,
    // post-hours-budget) — the week's *actual* target once taper reshaping
    // and availability clamp it, distinct from trainingBlocks.targetLoadTotal
    // which stays the un-tapered skeleton value. null on rows written before
    // this column existed and on rows the adaptive engines never touch.
    effectiveTarget: real("effective_target"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("week_plans_user_week_uq").on(t.userId, t.weekStart),
    index("week_plans_user_status_idx").on(t.userId, t.status),
  ]
);

export const planAdjustments = pgTable(
  "plan_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    weekPlanId: uuid("week_plan_id")
      .notNull()
      .references(() => weekPlans.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    trigger: text("trigger", {
      enum: [
        "low_readiness",
        "no_time",
        "missed_workout",
        "availability_change",
        "weekly_rollover",
        "race",
      ],
    }).notNull(),
    action: text("action", {
      enum: ["scaled", "moved", "swapped", "dropped", "redistributed"],
    }).notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("plan_adjustments_week_idx").on(t.weekPlanId, t.date)]
);

// ── v0.18 Security Hardening ──────────────────────────────────────────────

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable: a failed login has no authenticated user.
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  event: text("event", {
    enum: [
      "login_success",
      "login_fail",
      "token_created",
      "token_revoked",
      "connection_added",
      "connection_revoked",
    ],
  }).notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
