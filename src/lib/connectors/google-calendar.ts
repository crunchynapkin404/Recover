import { encrypt, decrypt } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export interface CalendarBusyBlock {
  start: string; // ISO datetime
  end: string;
  summary?: string;
}

/** Refresh the Google access token using the stored refresh token. */
export async function refreshAccessToken(
  connectionId: string,
  refreshToken: string
): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`);
  const data = await res.json();
  // Update stored access token
  await db
    .update(schema.connections)
    .set({ encryptedAccessToken: encrypt(data.access_token) })
    .where(eq(schema.connections.id, connectionId));
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
