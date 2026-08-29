import { NextRequest, NextResponse } from "next/server";
import { createAlpacaClientFromEnv } from "@/lib/alpaca/client";

/**
 * Temporary debug endpoint to confirm the Alpaca paper account is reachable
 * and the key pair works, since this can't be tested from the dev sandbox
 * (network egress restrictions there block direct calls to Alpaca).
 * Not linked from the dashboard; protected by CRON_SECRET so it isn't a
 * public account-info leak. Remove once day-trader-v1's cron route is live
 * and verified.
 */
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const client = createAlpacaClientFromEnv("DAY_TRADER_V1");
    const [account, positions, orders] = await Promise.all([
      client.getAccount(),
      client.getPositions(),
      client.listOrders({ status: "all", limit: 50 }),
    ]);
    return NextResponse.json({ account, positions, orders });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
