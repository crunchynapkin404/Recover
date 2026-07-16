import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { IntervalsCard } from "@/components/settings/intervals-card";
import { NotificationsCard } from "@/components/settings/notifications-card";
import { BodyPrefsCard } from "@/components/settings/body-prefs-card";
import { getVapidKeys } from "@/lib/push";
import { LlmSettingsCard } from "@/components/settings/llm-settings-card";
import { CoachCard } from "@/components/settings/coach-card";
import { listMemories } from "@/lib/coach-memory";
import { ApiTokensCard } from "@/components/settings/api-tokens-card";
import { StravaCard } from "@/components/settings/strava-card";
import { SignOutButton } from "@/components/sign-out-button";
import Link from "next/link";
import { User } from "lucide-react";
import { DEFAULT_SLEEP_NEED_SECS } from "@/lib/sleep-debt";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ strava_error?: string }>;
}) {
  const user = await requireUser();
  const { strava_error } = await searchParams;

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

        {/* Connections */}
        <section className="space-y-4">
          <h3 className="label-micro px-2">Connections</h3>
          <IntervalsCard
            connection={
              connection
                ? {
                    athleteName:
                      connection.externalAthleteName ??
                      connection.externalAthleteId,
                    status: connection.status,
                    lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
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
        </section>

        {/* AI Coach */}
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

        {/* Coach personality & memory */}
        <CoachCard
          configured={!!llmSettings}
          personality={llmSettings?.coachPersonality ?? "encouraging"}
          memories={coachMemories.map((m) => ({
            id: m.id,
            category: m.category,
            content: m.content,
          }))}
        />

        {/* MCP Tokens */}
        <ApiTokensCard
          tokens={apiTokens.map((t) => ({
            id: t.id,
            label: t.label,
            scopes: t.scopes,
            lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
            createdAt: t.createdAt.toISOString(),
          }))}
        />

        {/* Notifications */}
        <NotificationsCard
          vapidPublicKey={vapid.publicKey}
          morningPushEnabled={notificationPrefs?.morningPushEnabled ?? true}
          subscriptionCount={pushSubs.length}
        />

        <BodyPrefsCard
          wakeTime={bodyPrefsRow?.wakeTime ?? null}
          sleepNeedSecs={bodyPrefsRow?.sleepNeedSecs ?? DEFAULT_SLEEP_NEED_SECS}
        />

        {/* App Preferences */}
        <section className="glass rounded-[2.5rem] p-6 space-y-4">
          <h3 className="label-micro">App Preferences</h3>
          <div className="space-y-1">
            <div className="flex items-center justify-between py-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">Appearance</span>
                <span className="text-[10px] font-bold uppercase text-white/50">
                  Dark (only theme for now)
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-white/5 py-3">
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
          </div>
        </section>

        {/* About */}
        <section className="pb-12 text-center">
          <div className="flex flex-col items-center gap-2">
            <h2 className="text-xl font-bold tracking-tighter opacity-40">
              Recover
            </h2>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
              Self-hosted · AGPL-3.0
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
