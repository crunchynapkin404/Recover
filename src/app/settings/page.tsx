import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getMySessions } from "@/lib/sessions";
import { AppShell } from "@/components/app-shell";
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
  Info,
} from "lucide-react";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    strava_error?: string;
    whoop_error?: string;
    oura_error?: string;
    withings_error?: string;
  }>;
}) {
  const session = await requireSession();
  const user = session.user;
  const { strava_error, whoop_error, withings_error } = await searchParams;

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

  return (
    <AppShell>
      {/* Header */}
      <header className="mb-8 pt-8">
        <h1 className="text-2xl font-bold tracking-tighter">Settings</h1>
        <p className="mt-1 text-xs font-medium uppercase tracking-widest text-white/50">
          App configuration & accounts
        </p>
      </header>

      <div className="space-y-6">
        {/* Profile */}
        <section className="glass rounded-[2rem] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="label-micro">Profile</h3>
          </div>
          <div className="flex items-center gap-4">
            <div className="glass flex h-14 w-14 items-center justify-center rounded-full border-white/10">
              <User className="size-6 text-white/60" />
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-bold">
                {user.name ?? "Athlete"}
              </span>
              <span className="text-sm text-white/50">{user.email}</span>
            </div>
          </div>
          {user.role === "owner" && (
            <div className="mt-4 border-t border-white/5 pt-4">
              <Link
                href="/admin"
                className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 hover:underline"
              >
                Admin — members & invites
              </Link>
            </div>
          )}
          <div className="mt-4 border-t border-white/5 pt-4">
            <SignOutButton />
          </div>
        </section>

        {/* Integrations */}
        <Collapsible>
          <CollapsibleTrigger>
            <Layers aria-hidden className="size-[18px] text-blue-400" />
            <span className="text-xs font-bold uppercase tracking-widest text-white/80">
              Integrations
            </span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="space-y-4 p-5 pt-4">
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

        {/* AI & Tech */}
        <Collapsible>
          <CollapsibleTrigger>
            <Sparkles aria-hidden className="size-[18px] text-emerald-400" />
            <span className="text-xs font-bold uppercase tracking-widest text-white/80">
              AI &amp; Tech
            </span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="space-y-4 p-5 pt-4">
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
          <CollapsibleTrigger>
            <Terminal aria-hidden className="size-[18px] text-white/40" />
            <span className="text-xs font-bold uppercase tracking-widest text-white/80">
              Advanced / API
            </span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="space-y-4 p-5 pt-4">
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
                webhooks={webhookSubscriptions.map((w) => ({
                  id: w.id,
                  url: w.url,
                  events: w.events ?? [],
                  createdAt: w.createdAt.toISOString(),
                }))}
              />
            </div>
          </CollapsiblePanel>
        </Collapsible>

        {/* App */}
        <Collapsible>
          <CollapsibleTrigger>
            <SlidersHorizontal
              aria-hidden
              className="size-[18px] text-orange-400"
            />
            <span className="text-xs font-bold uppercase tracking-widest text-white/80">
              App
            </span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="space-y-4 p-5 pt-4">
              <NotificationsCard
                vapidPublicKey={vapid.publicKey}
                morningPushEnabled={
                  notificationPrefs?.morningPushEnabled ?? true
                }
                subscriptionCount={pushSubs.length}
              />

              <RideDebriefCard />

              <LlmUsageCard />

              <BodyPrefsCard
                wakeTime={bodyPrefsRow?.wakeTime ?? null}
                sleepNeedSecs={
                  bodyPrefsRow?.sleepNeedSecs ?? DEFAULT_SLEEP_NEED_SECS
                }
                maxHr={bodyPrefsRow?.maxHr ?? null}
                ftpWatts={bodyPrefsRow?.ftpWatts ?? null}
              />

              <div className="space-y-1">
                <div className="flex items-center justify-between py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Data Export</span>
                    <span className="text-[10px] font-bold uppercase text-white/50">
                      Download all your data as JSON
                    </span>
                  </div>
                  <a
                    href="/api/export"
                    download
                    aria-label="Download all your data as JSON"
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-white/80 transition-colors hover:bg-white/10"
                  >
                    Export
                  </a>
                </div>
                <div className="flex items-center justify-between border-t border-white/5 py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Import CSV</span>
                    <span className="text-[10px] font-bold uppercase text-white/50">
                      Wellness or activity data from any source
                    </span>
                  </div>
                  <Link
                    href="/import"
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-white/80 transition-colors hover:bg-white/10"
                  >
                    Import
                  </Link>
                </div>
                <div className="flex items-center justify-between border-t border-white/5 py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      Health &amp; Biomarkers
                    </span>
                    <span className="text-[10px] font-bold uppercase text-white/50">
                      Blood work, blood pressure, biological age
                    </span>
                  </div>
                  <Link
                    href="/health"
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-white/80 transition-colors hover:bg-white/10"
                  >
                    Open
                  </Link>
                </div>
              </div>
            </div>
          </CollapsiblePanel>
        </Collapsible>

        {/* About */}
        <Collapsible>
          <CollapsibleTrigger>
            <Info aria-hidden className="size-[18px] text-white/20" />
            <span className="text-xs font-bold uppercase tracking-widest text-white/80">
              About
            </span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="p-5 pt-4 text-center">
              <h2 className="text-xl font-bold tracking-tighter opacity-40">
                Recover
              </h2>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                Self-hosted · AGPL-3.0
              </p>
            </div>
          </CollapsiblePanel>
        </Collapsible>
      </div>
    </AppShell>
  );
}
