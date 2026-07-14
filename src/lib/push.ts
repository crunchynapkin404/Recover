/**
 * Web-push pipeline: payload building, VAPID key management, delivery.
 * Morning readiness push guards live here too (see maybeSendMorningReadinessPush).
 */
import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

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
  return {
    title: `Readiness ${Math.round(m.readiness)} · ${band}`,
    body: metrics ? `${metrics} — ${BAND_LINES[m.band]}` : BAND_LINES[m.band],
    tag: "morning-readiness",
    url: "/",
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
  return { publicKey: pub, privateKey: decrypt(priv) };
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
