import { NextRequest, NextResponse } from "next/server";
import { createAlpacaClientFromEnv } from "@/lib/alpaca/client";
import { unauthorizedIfBadCronSecret } from "@/lib/cronAuth";
import { isForceCloseWindow } from "@/lib/time";
import { closePosition, getOpenPosition } from "@/lib/bots/day-trader-v1/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Independent hard force-close at 3:55pm ET, regardless of P&L. Runs as its
 * own cron route (rather than a branch inside the main scan route) so a bug
 * in signal logic can never prevent the close-out — this route does one
 * thing: if it's past 3:55pm ET and the bot has an open position, close it.
 */
export async function GET(req: NextRequest) {
  const authError = unauthorizedIfBadCronSecret(req);
  if (authError) return authError;

  const now = new Date();
  if (!isForceCloseWindow(now)) {
    return NextResponse.json({ skipped: "not_force_close_window" });
  }

  const openPosition = await getOpenPosition();
  if (!openPosition) {
    return NextResponse.json({ skipped: "no_open_position" });
  }

  const alpaca = createAlpacaClientFromEnv("DAY_TRADER_V1");

  try {
    // Cancels the bracket's open stop/take-profit legs, then market-closes
    // the position. This works even if the bracket legs were somehow never
    // filled or acknowledged.
    await alpaca.closeAllPositions();

    // The close is async on Alpaca's side — poll briefly for the fill so we
    // can record a real exit price instead of leaving it null.
    let filledOrder = null;
    for (let attempt = 0; attempt < 5 && !filledOrder; attempt++) {
      await sleep(1000);
      const recentOrders = await alpaca.listOrders({
        status: "closed",
        symbols: [openPosition.symbol],
        limit: 5,
      });
      filledOrder = recentOrders.find(
        (o) => o.side === "sell" && o.status === "filled" && o.filled_avg_price
      );
    }

    const exitPrice = filledOrder?.filled_avg_price
      ? Number(filledOrder.filled_avg_price)
      : Number(openPosition.entry_price ?? 0);

    const closed = await closePosition({
      positionId: openPosition.id,
      exitPrice,
      exitReason: "force_close",
      closedAt: filledOrder?.filled_at ?? new Date().toISOString(),
    });

    return NextResponse.json({
      action: "force_closed",
      symbol: openPosition.symbol,
      exitPrice,
      realizedPnl: closed.realized_pnl,
      confirmedFill: Boolean(filledOrder),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
