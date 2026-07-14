import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";

async function sessionUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

export async function POST(req: Request) {
  const userId = await sessionUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth)
    return NextResponse.json(
      { error: "invalid subscription" },
      { status: 400 }
    );

  await db
    .insert(schema.pushSubscriptions)
    .values({
      userId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: req.headers.get("user-agent"),
    })
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: { userId, p256dh: body.keys.p256dh, auth: body.keys.auth },
    });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const userId = await sessionUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json()) as { endpoint?: string };
  if (!body.endpoint)
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  await db
    .delete(schema.pushSubscriptions)
    .where(
      and(
        eq(schema.pushSubscriptions.userId, userId),
        eq(schema.pushSubscriptions.endpoint, body.endpoint)
      )
    );
  return NextResponse.json({ ok: true });
}
