import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { recordSurfaceView } from "@/lib/telemetry";
import { getMySessions } from "@/lib/sessions";
import { AppShell, shellUser, avatarInitial } from "@/components/app-shell";
import { IntervalsCard } from "@/components/settings/intervals-card";
import { NotificationsCard } from "@/components/settings/notifications-card";
import { BodyPrefsCard } from "@/components/settings/body-prefs-card";
import { getVapidKeys } from "@/lib/push";
import { LlmSettingsCard } from "@/components/settings/llm-settings-card";
import { CoachCard } from "@/components/settings/coach-card";
import { listMemories } from "@/lib/coach-memory";
import { ApiTokensCard } from "@/components/settings/api-tokens-card";
import { WebhooksCard } from "@/components/settings/webhooks-card";
import { SessionsCard } from "@/components/settings/sessions-card";
import { StravaCard } from "@/components/settings/strava-card";
import { WhoopCard } from "@/components/settings/whoop-card";
import { whoopConfigured } from "@/lib/connectors/whoop";
import { OuraCard } from "@/components/settings/oura-card";
import { AppleHealthCard } from "@/components/settings/apple-health-card";
import { WithingsCard } from "@/components/settings/withings-card";
import { withingsConfigured } from "@/lib/connectors/withings";
import { RideDebriefCard } from "@/components/settings/ride-debrief-card";
import { LlmUsageCard } from "@/components/settings/llm-usage-card";
import { SignOutButton } from "@/components/sign-out-button";
import Link from "next/link";
import { User } from "lucide-react";
import { baselinesSummary } from "@/lib/settings/baselines-summary";
import { DEFAULT_SLEEP_NEED_SECS } from "@/lib/sleep-debt";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
} from "@/components/ui/collapsible";
import {
  Layers,
  Sparkles,
  Terminal,
  SlidersHorizontal,
  Gauge,
  Download,
} from "lucide-react";

// The six Collapsible section triggers below share this pair of class
// strings verbatim; hoisted so each token swap happens once instead of
// six times (the same argument that drove connector-card.tsx's shell
// extraction earlier in this release).
const triggerBadgeClass = "text-label font-medium text-ink-muted";
const triggerLabelClass =
  "text-label font-bold uppercase tracking-widest text-ink-secondary";

// The Data section's two export/import CTAs are identical to each other,
// and their detail lines (directly below each row's title) are too.
const dataButtonClass =
  "rounded-full border border-hairline bg-surface-overlay px-4 py-2 text-label font-bold uppercase tracking-wider text-ink-secondary transition-colors hover:bg-surface-selected";
const dataDetailClass = "text-label font-bold uppercase text-ink-muted";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    strava_error?: string;
    whoop_error?: string;
    oura_error?: string;
    withings_error?: string;
    /** Opens one section on load — see `opened` below. */
    open?: string;
  }>;
}) {
  const session = await requireSession();
  const user = session.user;
  await recordSurfaceView(user.id, "settings");
  // `open` is renamed on destructure: `open` alone shadows nothing here but
  // reads as a boolean, and this is a section name.
  const {
    strava_error,
    whoop_error,
    withings_error,
    open: opened,
  } = await searchParams;

  const { sessions: activeSessions } = await getMySessions(
    user.id,
    session.session.id
  );

  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, user.id),
      eq(schema.connections.provider, "intervals_icu")
    ),
  });

  const backfillJob = connection
    ? await db.query.syncJobs.findFirst({
        where: and(
          eq(schema.syncJobs.userId, user.id),
          eq(schema.syncJobs.kind, "backfill"),
          inArray(schema.syncJobs.status, ["pending", "running"])
        ),
        columns: { id: true },
      })
    : null;

  const stravaConnection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, user.id),
      eq(schema.connections.provider, "strava")
    ),
  });

  const whoopConnection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, user.id),
      eq(schema.connections.provider, "whoop")
    ),
  });

  const ouraConnection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, user.id),
      eq(schema.connections.provider, "oura")
    ),
  });

  const appleHealthConnection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, user.id),
      eq(schema.connections.provider, "apple_health")
    ),
  });

  const withingsConnection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, user.id),
      eq(schema.connections.provider, "withings")
    ),
  });

  const llmSettings = await db.query.llmSettings.findFirst({
    where: eq(schema.llmSettings.userId, user.id),
  });

  const coachMemories = await listMemories(user.id);

  const apiTokens = await db.query.apiTokens.findMany({
    where: and(
      eq(schema.apiTokens.userId, user.id),
      isNull(schema.apiTokens.revokedAt)
    ),
  });

  const webhookSubscriptions = await db.query.webhookSubscriptions.findMany({
    where: and(
      eq(schema.webhookSubscriptions.userId, user.id),
      eq(schema.webhookSubscriptions.active, true)
    ),
  });

  // Latest delivery per subscription, in one query (not N+1): DISTINCT ON
  // (subscription_id) ordered by created_at desc is served directly by the
  // webhook_deliveries_subscription_idx (subscriptionId, createdAt) index.
  const subIds = webhookSubscriptions.map((w) => w.id);
  const lastDeliveries = subIds.length
    ? await db
        .selectDistinctOn([schema.webhookDeliveries.subscriptionId])
        .from(schema.webhookDeliveries)
        .where(inArray(schema.webhookDeliveries.subscriptionId, subIds))
        .orderBy(
          schema.webhookDeliveries.subscriptionId,
          desc(schema.webhookDeliveries.createdAt)
        )
    : [];
  const lastBySub = new Map(lastDeliveries.map((d) => [d.subscriptionId, d]));

  const [vapid, notificationPrefs, pushSubs] = await Promise.all([
    getVapidKeys(),
    db.query.notificationPrefs.findFirst({
      where: eq(schema.notificationPrefs.userId, user.id),
    }),
    db.query.pushSubscriptions.findMany({
      where: eq(schema.pushSubscriptions.userId, user.id),
      columns: { id: true },
    }),
  ]);

  const bodyPrefsRow = await db.query.bodyPrefs.findFirst({
    where: eq(schema.bodyPrefs.userId, user.id),
  });

  const initial = avatarInitial(user);

  // ── Group summary lines (2c) ──────────────────────────────────────────
  // Each one states what is actually configured, so a closed group still
  // answers "is this set up?". Nothing is claimed that isn't in the data.
  const connectedProviders = [
    connection?.status === "active" ? "intervals.icu" : null,
    stravaConnection?.status === "active" ? "Strava" : null,
    whoopConnection?.status === "active" ? "Whoop" : null,
    ouraConnection?.status === "active" ? "Oura" : null,
    appleHealthConnection?.status === "active" ? "Apple Health" : null,
    withingsConnection?.status === "active" ? "Withings" : null,
  ].filter((p): p is string => p !== null);

  const integrationsSummary =
    connectedProviders.length === 0
      ? "none connected"
      : connectedProviders.length <= 2
        ? connectedProviders.join(" · ")
        : `${connectedProviders[0]} · +${connectedProviders.length - 1} more`;

  const coachSummary = llmSettings
    ? [
        llmSettings.providerType === "anthropic"
          ? "Claude"
          : llmSettings.providerType === "openai_compatible"
            ? "OpenAI-compatible"
            : llmSettings.providerType,
        llmSettings.defaultMode,
        `${coachMemories.length} ${coachMemories.length === 1 ? "memory" : "memories"}`,
      ].join(" · ")
    : "not configured";

  // App is now push and app behaviour only. Wake time and FTP moved out with
  // BodyPrefsCard — a badge summarising the athlete's own thresholds under a
  // section labelled "App" was part of what made them unfindable.
  const appSummary =
    notificationPrefs?.morningPushEnabled === false
      ? "push off"
      : pushSubs.length > 0
        ? "push on"
        : "defaults";

  // The figures the engine reads back. Names what IS set and what is NOT —
  // "FTP 250" alone read as done while the run anchor was missing, which was
  // every production user's state. See the module header for the argument.
  const baselines = baselinesSummary(bodyPrefsRow);

  const advancedSummary = [
    `${apiTokens.length} ${apiTokens.length === 1 ? "token" : "tokens"}`,
    `${webhookSubscriptions.length} ${webhookSubscriptions.length === 1 ? "webhook" : "webhooks"}`,
    `${activeSessions.length} ${activeSessions.length === 1 ? "session" : "sessions"}`,
  ].join(" · ");

  return (
    <AppShell user={shellUser(user)}>
      {/* Header */}
      <header className="mb-5 pt-8">
        <h1 className="text-heading font-bold tracking-[-0.03em]">Settings</h1>
      </header>

      <div className="space-y-3">
        {/* Profile — one slim row, not a card of its own */}
        <section className="flex items-center gap-3 rounded-[18px] border border-hairline bg-surface-overlay px-4 py-3">
          <span className="glass flex size-[38px] shrink-0 items-center justify-center rounded-full">
            {initial ? (
              <span
                aria-hidden
                className="text-caption font-bold text-ink-secondary"
              >
                {initial}
              </span>
            ) : (
              <User aria-hidden className="size-5 text-ink-muted" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-caption font-bold">
              {user.name ?? "Athlete"}
            </span>
            <span className="block truncate text-label text-ink-muted">
              {user.email}
              {user.role === "owner" && " · owner"}
            </span>
          </span>
          {user.role === "owner" && (
            <Link
              href="/admin"
              className="shrink-0 text-label font-bold uppercase tracking-wider text-accent hover:underline"
            >
              Admin →
            </Link>
          )}
        </section>

        {/* Integrations */}
        <Collapsible>
          <CollapsibleTrigger
            badge={
              <span className={triggerBadgeClass}>{integrationsSummary}</span>
            }
          >
            <Layers aria-hidden className="size-[18px] text-ink-muted" />
            <span className={triggerLabelClass}>Integrations</span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="hairline-list px-5 pb-3">
              <IntervalsCard
                connection={
                  connection
                    ? {
                        athleteName:
                          connection.externalAthleteName ??
                          connection.externalAthleteId,
                        status: connection.status,
                        lastSyncAt:
                          connection.lastSyncAt?.toISOString() ?? null,
                        lastError: connection.lastError,
                        wellnessPollIntervalMin:
                          connection.wellnessPollIntervalMin,
                        lastWellnessPollAt:
                          connection.lastWellnessPollAt?.toISOString() ?? null,
                        backfillRunning: backfillJob != null,
                      }
                    : null
                }
              />

              <StravaCard
                configured={!!process.env.STRAVA_CLIENT_ID}
                errorParam={strava_error}
                autoDescribe={notificationPrefs?.autoDescribeStrava ?? false}
                descriptionFields={
                  notificationPrefs?.stravaDescriptionFields ?? null
                }
                connection={
                  stravaConnection
                    ? {
                        athleteName:
                          stravaConnection.externalAthleteName ??
                          stravaConnection.externalAthleteId,
                        status: stravaConnection.status,
                        lastSyncAt:
                          stravaConnection.lastSyncAt?.toISOString() ?? null,
                        lastError: stravaConnection.lastError,
                        writeEnabled: stravaConnection.stravaWriteEnabled,
                      }
                    : null
                }
              />

              <WhoopCard
                configured={whoopConfigured()}
                errorParam={whoop_error}
                connection={
                  whoopConnection
                    ? {
                        athleteName:
                          whoopConnection.externalAthleteName ??
                          whoopConnection.externalAthleteId,
                        status: whoopConnection.status,
                        lastSyncAt:
                          whoopConnection.lastSyncAt?.toISOString() ?? null,
                        lastError: whoopConnection.lastError,
                      }
                    : null
                }
              />

              <OuraCard
                connection={
                  ouraConnection
                    ? {
                        accountName: ouraConnection.externalAthleteName ?? "",
                        status: ouraConnection.status,
                        lastSyncAt:
                          ouraConnection.lastSyncAt?.toISOString() ?? null,
                        lastError: ouraConnection.lastError,
                      }
                    : null
                }
              />

              <AppleHealthCard
                connected={!!appleHealthConnection}
                lastSyncAt={
                  appleHealthConnection?.lastSyncAt?.toISOString() ?? null
                }
                baseUrlConfigured={!!process.env.BETTER_AUTH_URL}
              />

              <WithingsCard
                configured={withingsConfigured()}
                errorParam={withings_error}
                connection={
                  withingsConnection
                    ? {
                        status: withingsConnection.status,
                        lastSyncAt:
                          withingsConnection.lastSyncAt?.toISOString() ?? null,
                        lastError: withingsConnection.lastError,
                      }
                    : null
                }
              />
            </div>
          </CollapsiblePanel>
        </Collapsible>

        {/* Your baselines — second, directly under Integrations, and that
            order is the argument. Integrations bring the athlete's data in;
            these are the figures the engine reads it against. Everything
            below is peripheral to whether a number is right.

            This card used to sit inside "App", between the push toggles and
            LLM usage, because it was none of integrations/coach/API/data —
            "App" was the drawer's drawer. But wake time, max HR, FTP and the
            1RMs are not settings ABOUT THE APP: they are the athlete's own
            baselines, and the roadmap's goal sentence turns on exactly that
            word ("Baselines are the athlete's own, not population norms").
            They are the inputs behind every figure the app defends, so when
            a number looks wrong this is the page to reach — and it was five
            screens down under a label that did not name it. */}
        <Collapsible id="baselines" defaultOpen={opened === "baselines"}>
          <CollapsibleTrigger
            badge={
              <span className={triggerBadgeClass}>{baselines}</span>
            }
          >
            <Gauge aria-hidden className="size-[18px] text-ink-muted" />
            <span className={triggerLabelClass}>Your baselines</span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="hairline-list px-5 pb-3">
              <BodyPrefsCard
                wakeTime={bodyPrefsRow?.wakeTime ?? null}
                sleepNeedSecs={
                  bodyPrefsRow?.sleepNeedSecs ?? DEFAULT_SLEEP_NEED_SECS
                }
                maxHr={bodyPrefsRow?.maxHr ?? null}
                ftpWatts={bodyPrefsRow?.ftpWatts ?? null}
                ftpWattsIndoor={bodyPrefsRow?.ftpWattsIndoor ?? null}
                thresholdPaceSecPerKm={
                  bodyPrefsRow?.thresholdPaceSecPerKm ?? null
                }
                squatOneRmKg={bodyPrefsRow?.squatOneRmKg ?? null}
                benchOneRmKg={bodyPrefsRow?.benchOneRmKg ?? null}
                deadliftOneRmKg={bodyPrefsRow?.deadliftOneRmKg ?? null}
                overheadPressOneRmKg={
                  bodyPrefsRow?.overheadPressOneRmKg ?? null
                }
              />
            </div>
          </CollapsiblePanel>
        </Collapsible>

        {/* AI & Coach — addressable, because chat-interface.tsx sends an
            unconfigured coach here and "in Settings" is not a location. */}
        <Collapsible id="coach" defaultOpen={opened === "coach"}>
          <CollapsibleTrigger
            badge={<span className={triggerBadgeClass}>{coachSummary}</span>}
          >
            <Sparkles aria-hidden className="size-[18px] text-ink-muted" />
            <span className={triggerLabelClass}>AI &amp; Coach</span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="hairline-list px-5 pb-3">
              <LlmSettingsCard
                settings={
                  llmSettings
                    ? {
                        providerType: llmSettings.providerType,
                        model: llmSettings.model,
                        modelQuick: llmSettings.modelQuick,
                        modelDeep: llmSettings.modelDeep,
                        defaultMode: llmSettings.defaultMode,
                        baseUrl: llmSettings.baseUrl,
                        hasKey: !!llmSettings.encryptedApiKey,
                      }
                    : null
                }
              />

              <CoachCard
                configured={!!llmSettings}
                personality={llmSettings?.coachPersonality ?? "encouraging"}
                language={llmSettings?.coachLanguage ?? "auto"}
                memories={coachMemories.map((m) => ({
                  id: m.id,
                  category: m.category,
                  content: m.content,
                }))}
              />
            </div>
          </CollapsiblePanel>
        </Collapsible>

        {/* Advanced / API */}
        <Collapsible>
          <CollapsibleTrigger
            badge={<span className={triggerBadgeClass}>{advancedSummary}</span>}
          >
            <Terminal aria-hidden className="size-[18px] text-ink-muted" />
            <span className={triggerLabelClass}>Advanced / API</span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="hairline-list px-5 pb-3">
              <SessionsCard sessions={activeSessions} />

              <ApiTokensCard
                tokens={apiTokens.map((t) => ({
                  id: t.id,
                  label: t.label,
                  scopes: t.scopes,
                  lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
                  createdAt: t.createdAt.toISOString(),
                }))}
              />

              <WebhooksCard
                webhooks={webhookSubscriptions.map((w) => {
                  const d = lastBySub.get(w.id);
                  return {
                    id: w.id,
                    url: w.url,
                    events: w.events ?? [],
                    createdAt: w.createdAt.toISOString(),
                    lastDelivery: d
                      ? {
                          status: d.status,
                          attempts: d.attempts,
                          at: d.createdAt.toISOString(),
                          lastError: d.lastError,
                        }
                      : null,
                  };
                })}
              />
            </div>
          </CollapsiblePanel>
        </Collapsible>

        {/* App */}
        <Collapsible>
          <CollapsibleTrigger
            badge={<span className={triggerBadgeClass}>{appSummary}</span>}
          >
            <SlidersHorizontal
              aria-hidden
              className="size-[18px] text-ink-muted"
            />
            <span className={triggerLabelClass}>App</span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="hairline-list px-5 pb-3">
              <NotificationsCard
                vapidPublicKey={vapid.publicKey}
                morningPushEnabled={
                  notificationPrefs?.morningPushEnabled ?? true
                }
                subscriptionCount={pushSubs.length}
              />

              <RideDebriefCard />

              <LlmUsageCard />
            </div>
          </CollapsiblePanel>
        </Collapsible>

        {/* Data — export and import get their own group (2c) */}
        <Collapsible>
          <CollapsibleTrigger
            badge={
              <span className={triggerBadgeClass}>Export · Import CSV</span>
            }
          >
            <Download aria-hidden className="size-[18px] text-ink-muted" />
            <span className={triggerLabelClass}>Data</span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="hairline-list px-5 pb-3">
              <div className="flex items-center justify-between py-3">
                <div className="flex flex-col">
                  <span className="text-caption font-medium">Data export</span>
                  <span className={dataDetailClass}>
                    Download all your data as JSON
                  </span>
                </div>
                <a
                  href="/api/export"
                  download
                  aria-label="Download all your data as JSON"
                  className={dataButtonClass}
                >
                  Export
                </a>
              </div>
              <div className="flex items-center justify-between border-t border-hairline py-3">
                <div className="flex flex-col">
                  <span className="text-caption font-medium">Import CSV</span>
                  <span className={dataDetailClass}>
                    Wellness or activity data from any source
                  </span>
                </div>
                <Link href="/import" className={dataButtonClass}>
                  Import
                </Link>
              </div>
            </div>
          </CollapsiblePanel>
        </Collapsible>

        <div className="pt-2">
          <SignOutButton />
        </div>

        <p className="pb-4 pt-2 text-center text-label font-bold uppercase tracking-[0.2em] text-ink-muted">
          Recover · Self-hosted · AGPL-3.0
        </p>
      </div>
    </AppShell>
  );
}
