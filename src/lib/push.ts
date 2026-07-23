/**
 * Web-push pipeline: payload building, VAPID key management, delivery.
 * Morning readiness push guards live here too (see maybeSendMorningReadinessPush).
 */
import webpush from "web-push";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { getLatestMorningInsight } from "@/lib/morning-insight";

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

export interface MorningMetricsInput {
  readiness: number;
  band: "green" | "amber" | "red";
  hrvMs: number | null;
  restingHr: number | null;
  sleepSecs: number | null;
  /** First sentence of today's coach insight (v0.4b), clamped to 120 chars. */
  insightTeaser?: string | null;
}

const BAND_LINES: Record<MorningMetricsInput["band"], string> = {
  green: "Green light — good day for intensity.",
  amber: "Moderate — keep quality controlled.",
  red: "Recovery day — keep it easy.",
};

export function buildMorningPayload(m: MorningMetricsInput): PushPayload {
  const parts: string[] = [];
  if (m.hrvMs != null) parts.push(`HRV ${Math.round(m.hrvMs)} ms`);
  if (m.restingHr != null) parts.push(`RHR ${Math.round(m.restingHr)}`);
  if (m.sleepSecs != null)
    parts.push(`Sleep ${(m.sleepSecs / 3600).toFixed(1)} h`);
  const metrics = parts.join(" · ");
  const band = m.band.charAt(0).toUpperCase() + m.band.slice(1);
  let body = metrics
    ? `${metrics} — ${BAND_LINES[m.band]}`
    : BAND_LINES[m.band];
  const teaser = m.insightTeaser?.trim();
  if (teaser) {
    body += `\n${teaser.length > 120 ? teaser.slice(0, 119) + "…" : teaser}`;
  }
  return {
    title: `Readiness ${Math.round(m.readiness)} · ${band}`,
    body,
    tag: "morning-readiness",
    // Deep-links into the open check-in sheet (1h): the point of the morning
    // push is the sixty seconds it asks for, not the dashboard.
    url: "/?sheet=checkin",
  };
}

export interface DebriefPushInput {
  activityId: string;
  activityName: string;
  durationS: number | null;
  load: number | null;
}

/** "1:15" — same compact clock the debrief sheet shows. */
function clock(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * Post-ride debrief push (1i). Carries the numbers the ride already has so
 * the athlete can answer from the notification's own context, and opens the
 * debrief sheet directly rather than the activity page.
 */
export function buildDebriefPayload(a: DebriefPushInput): PushPayload {
  const facts = [
    a.durationS != null ? clock(a.durationS) : null,
    a.load != null ? `load ${Math.round(a.load)}` : null,
  ].filter(Boolean);
  const detail = facts.length > 0 ? ` · ${facts.join(" · ")}` : "";
  return {
    title: "Ride synced — how did it go?",
    body: `${a.activityName}${detail}. How did it feel?`,
    tag: "ride-debrief",
    url: `/?sheet=debrief&activity=${a.activityId}`,
  };
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const VAPID_PUBLIC_KEY = "vapid_public_key";
const VAPID_PRIVATE_KEY = "vapid_private_key";

function vapidSubject(): string {
  const url = process.env.BETTER_AUTH_URL ?? "";
  // web-push requires an https: or mailto: subject.
  return url.startsWith("https://")
    ? url
    : "https://github.com/crunchynapkin404/Recover";
}

async function readVapidRows(): Promise<VapidKeys | null> {
  const rows = await db.query.appConfig.findMany({
    where: inArray(schema.appConfig.key, [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY]),
  });
  const pub = rows.find((r) => r.key === VAPID_PUBLIC_KEY)?.value;
  const priv = rows.find((r) => r.key === VAPID_PRIVATE_KEY)?.value;
  if (!pub || !priv) return null;
  try {
    return { publicKey: pub, privateKey: decrypt(priv) };
  } catch {
    // ENCRYPTION_KEY was rotated (or the row is corrupt): the stored private
    // key is unrecoverable. Drop the pair so a fresh one is generated —
    // existing subscriptions will fail against the new key and get pruned;
    // users re-enable notifications once. Better than a permanent 500.
    logger.error(
      "VAPID private key undecryptable — regenerating pair; push subscribers must re-enable notifications",
      {}
    );
    await db
      .delete(schema.appConfig)
      .where(
        inArray(schema.appConfig.key, [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY])
      );
    return null;
  }
}

/**
 * Read-or-create the instance VAPID key pair. Private key encrypted at rest.
 * Concurrent first calls converge via onConflictDoNothing + re-read.
 */
export async function getVapidKeys(): Promise<VapidKeys> {
  const existing = await readVapidRows();
  if (existing) return existing;

  const generated = webpush.generateVAPIDKeys();
  await db
    .insert(schema.appConfig)
    .values([
      { key: VAPID_PUBLIC_KEY, value: generated.publicKey },
      { key: VAPID_PRIVATE_KEY, value: encrypt(generated.privateKey) },
    ])
    .onConflictDoNothing();

  const settled = await readVapidRows();
  if (!settled) throw new Error("VAPID key initialization failed");
  return settled;
}

/**
 * Send a payload to every subscription the user has. 404/410 responses
 * prune the subscription; other failures log and continue.
 */
export async function sendToUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; pruned: number }> {
  const subs = await db.query.pushSubscriptions.findMany({
    where: eq(schema.pushSubscriptions.userId, userId),
  });
  if (subs.length === 0) return { sent: 0, pruned: 0 };

  const keys = await getVapidKeys();
  const json = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        json,
        {
          vapidDetails: {
            subject: vapidSubject(),
            publicKey: keys.publicKey,
            privateKey: keys.privateKey,
          },
        }
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db
          .delete(schema.pushSubscriptions)
          .where(eq(schema.pushSubscriptions.id, sub.id));
        pruned++;
      } else {
        logger.error("push send failed", {
          userId,
          status,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return { sent, pruned };
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function getOrCreatePrefs(userId: string) {
  await db
    .insert(schema.notificationPrefs)
    .values({ userId })
    .onConflictDoNothing();
  const prefs = await db.query.notificationPrefs.findFirst({
    where: eq(schema.notificationPrefs.userId, userId),
  });
  if (!prefs) throw new Error("notification prefs initialization failed");
  return prefs;
}

/**
 * Morning readiness push, at most once per day, only when today's score
 * exists. Server-local time (matches the scheduler's SYNC_HOUR reference).
 * The dedup stamp is written BEFORE sending, so partial delivery failures
 * never cause a second blast.
 */
export async function maybeSendMorningReadinessPush(
  userId: string,
  now: Date = new Date()
): Promise<boolean> {
  const hour = now.getHours();
  if (hour < 4 || hour >= 12) return false;

  const prefs = await getOrCreatePrefs(userId);
  if (!prefs.morningPushEnabled) return false;

  const today = localYmd(now);
  if (prefs.lastMorningPushDate === today) return false;

  const metrics = await db.query.dailyMetrics.findFirst({
    where: and(
      eq(schema.dailyMetrics.userId, userId),
      eq(schema.dailyMetrics.date, today)
    ),
  });
  if (!metrics || metrics.readiness == null || metrics.band === "calibrating")
    return false;

  const wellness = await db.query.wellnessDaily.findFirst({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      eq(schema.wellnessDaily.date, today)
    ),
  });

  await db
    .update(schema.notificationPrefs)
    .set({ lastMorningPushDate: today })
    .where(eq(schema.notificationPrefs.userId, userId));

  const insight = await getLatestMorningInsight(userId, now).catch(() => null);
  const insightTeaser = insight ? insight.text.split(/(?<=[.!?])\s/)[0] : null;

  const payload = buildMorningPayload({
    readiness: metrics.readiness,
    band: metrics.band as "green" | "amber" | "red",
    hrvMs: wellness?.hrvMs ?? null,
    restingHr: wellness?.restingHr ?? null,
    sleepSecs: wellness?.sleepSecs ?? null,
    insightTeaser,
  });
  const { sent, pruned } = await sendToUser(userId, payload);
  logger.info("morning push", { userId, sent, pruned });
  // The day is consumed once the stamp is written, regardless of delivery.
  return true;
}
