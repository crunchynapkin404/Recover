import { encrypt, decrypt } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export interface CalendarBusyBlock {
  start: string; // ISO datetime
  end: string;
  summary?: string;
}

type Connection = typeof schema.connections.$inferSelect;

const REFRESH_MARGIN_S = 120;

/**
 * Return a valid access token, refreshing via the stored refresh token when
 * the current one is near expiry. Google refresh tokens are reusable (unlike
 * Strava's single-use tokens), so no advisory lock is needed here.
 */
export async function getValidGoogleAccessToken(
  connection: Connection
): Promise<string> {
  const expiresAt = connection.expiresAt?.getTime() ?? 0;
  if (expiresAt > Date.now() + REFRESH_MARGIN_S * 1000) {
    return decrypt(connection.encryptedAccessToken);
  }
  if (!connection.encryptedRefreshToken) {
    // No refresh token (user didn't grant offline access) — best effort.
    return decrypt(connection.encryptedAccessToken);
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: decrypt(connection.encryptedRefreshToken),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`);
  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };

  await db
    .update(schema.connections)
    .set({
      encryptedAccessToken: encrypt(data.access_token),
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null,
      status: "active",
      lastError: null,
    })
    .where(eq(schema.connections.id, connection.id));

  return data.access_token;
}

/** Fetch busy/free times from Google Calendar. */
export async function fetchBusyTimes(params: {
  accessToken: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
}): Promise<CalendarBusyBlock[]> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: `${params.startDate}T00:00:00Z`,
      timeMax: `${params.endDate}T23:59:59Z`,
      items: [{ id: "primary" }],
    }),
  });
  if (!res.ok) throw new Error(`Google Calendar API error: ${res.status}`);
  const data = await res.json();
  const calendar = data.calendars?.primary;
  if (!calendar?.busy) return [];
  return calendar.busy.map((b: { start: string; end: string }) => ({
    start: b.start,
    end: b.end,
  }));
}
