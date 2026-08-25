import { NextRequest, NextResponse } from "next/server";

/**
 * Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET` on
 * scheduled invocations. Returns a 401 response if the header is missing or
 * wrong (also accepts `?secret=` for manual/browser testing), or null if the
 * request is authorized and the route should proceed.
 */
export function unauthorizedIfBadCronSecret(req: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  const headerOk = authHeader === `Bearer ${expected}`;
  const queryOk = req.nextUrl.searchParams.get("secret") === expected;

  if (!headerOk && !queryOk) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
