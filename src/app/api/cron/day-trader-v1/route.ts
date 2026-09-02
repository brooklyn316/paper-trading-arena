import { NextRequest, NextResponse } from "next/server";
import { createAlpacaClientFromEnv } from "@/lib/alpaca/client";
import { AlpacaBar } from "@/lib/alpaca/types";
import { unauthorizedIfBadCronSecret } from "@/lib/cronAuth";
import { momentumPct, sessionVWAP, volumeRatio } from "@/lib/indicators";
import { canOpenNewPosition, isMarketOpen, sessionStartUtcISO } from "@/lib/time";
import { BOT_ID, RISK, SIGNAL, WATCHLIST } from "@/lib/bots/day-trader-v1/config";
import {
  backfillEntryFill,
  closePosition,
  getCurrentTrackedCash,
  getOpenPosition,
  getOrderRowsByIds,
  getSymbolsStoppedOutToday,
  maxPositionDollars,
  recordEquityTick,
  recordNewBracketPosition,
  recordScanLog,
} from "@/lib/bots/day-trader-v1/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const authError = unauthorizedIfBadCronSecret(req);
  if (authError) return authError;

  const now = new Date();
  if (!isMarketOpen(now)) {
    return NextResponse.json({ skipped: "market_closed" });
  }

  const alpaca = createAlpacaClientFromEnv("DAY_TRADER_V1");
  const log: Record<string, unknown> = { ranAt: now.toISOString() };

  try {
    // --- 1. Reconciliation: does our DB's view of the open position match Alpaca? ---
    let openPosition = await getOpenPosition();
    const [alpacaPositions] = await Promise.all([alpaca.getPositions()]);
    const alpacaPositionForOpenSymbol = openPosition
      ? alpacaPositions.find((p) => p.symbol === openPosition!.symbol)
      : undefined;

    if (openPosition && !alpacaPositionForOpenSymbol) {
      // DB thinks a position is open, but Alpaca has no matching position —
      // a bracket leg (stop-loss or take-profit) must have filled and closed it.
      const reconciled = await reconcileClosedByBracketLeg(alpaca, openPosition);
      log.reconciled = reconciled;
      console.log(`[day-trader-v1] ${now.toISOString()} reconciled ${openPosition.symbol}:`, reconciled);
      // Only clear the local flag once the DB row itself is actually closed —
      // if neither leg shows a fill yet, the DB (and Alpaca) both still
      // consider the position open, and a new entry must stay blocked.
      if (reconciled.status === "closed" || reconciled.status === "closed_dead_entry") {
        openPosition = null;
      }
    } else if (openPosition && alpacaPositionForOpenSymbol && openPosition.entry_price === null) {
      // Entry order has now filled — backfill the real fill price.
      if (openPosition.entry_order_id) {
        try {
          await backfillEntryFill(
            openPosition.id,
            openPosition.entry_order_id,
            Number(alpacaPositionForOpenSymbol.avg_entry_price),
            new Date().toISOString()
          );
          openPosition = { ...openPosition, entry_price: Number(alpacaPositionForOpenSymbol.avg_entry_price) };
          console.log(
            `[day-trader-v1] ${now.toISOString()} backfilled entry fill for ${openPosition.symbol} (position ${openPosition.id}): ${alpacaPositionForOpenSymbol.avg_entry_price}`
          );
        } catch (err) {
          // Don't let a backfill failure take down the whole cycle (equity
          // tracking and force-close eligibility below don't depend on it) —
          // but do surface it, since a silent, repeated failure here is
          // exactly what made a real incident hard to diagnose after the
          // fact (2026-08-31: no logging existed at all in this route).
          console.error(
            `[day-trader-v1] ${now.toISOString()} FAILED to backfill entry fill for ${openPosition.symbol} (position ${openPosition.id}):`,
            err instanceof Error ? err.message : err
          );
          log.backfillError = err instanceof Error ? err.message : String(err);
        }
      }
      log.backfilledEntryPrice = alpacaPositionForOpenSymbol.avg_entry_price;
    } else if (!openPosition && alpacaPositions.length > 0) {
      // Alpaca has an open position our DB doesn't know about — self-heal by
      // adopting it so it isn't silently forgotten (and so force-close still
      // manages it later today).
      log.orphanedAlpacaPositions = alpacaPositions.map((p) => p.symbol);
      console.error(
        `[day-trader-v1] ${now.toISOString()} orphaned Alpaca position(s) our DB doesn't know about:`,
        log.orphanedAlpacaPositions
      );
    }

    // --- 2. Track equity every cycle for the live equity curve. ---
    const trackedCash = await getCurrentTrackedCash();
    const marketValue = alpacaPositions.reduce((sum, p) => sum + Number(p.market_value), 0);
    // trackedCash is starting_cash + closed-trade P&L only — it has no idea
    // money is currently tied up in an open position. Recording it as-is
    // while a position is open double-counts that position: once as
    // untouched "cash", again as the stock's market value. Net out what's
    // actually still invested (Alpaca's own cost_basis for each open
    // position) so cash + marketValue lands on the real equity.
    const openCostBasis = alpacaPositions.reduce((sum, p) => sum + Number(p.cost_basis), 0);
    const netCash = trackedCash - openCostBasis;
    await recordEquityTick({ cash: netCash, marketValue });
    log.trackedCash = trackedCash;
    log.netCash = netCash;
    log.marketValue = marketValue;

    // --- 3. If a position is already open, don't look for a new entry. ---
    if (openPosition) {
      return NextResponse.json({ ...log, action: "position_already_open", symbol: openPosition.symbol });
    }

    // Safety net: if Alpaca shows an open position our DB doesn't know about,
    // never mind that it isn't fully reconstructed yet — do NOT open a second
    // position on top of it. "One position at a time" is enforced here even
    // when reconciliation itself is incomplete.
    if (alpacaPositions.length > 0) {
      return NextResponse.json({
        ...log,
        action: "skipped_unreconciled_alpaca_position",
        symbols: alpacaPositions.map((p) => p.symbol),
      });
    }

    if (!canOpenNewPosition(now)) {
      return NextResponse.json({ ...log, action: "past_new_position_cutoff" });
    }

    // --- 4. Scan the watchlist for the first qualifying signal. ---
    const sessionStart = sessionStartUtcISO(now);
    const stoppedOutToday = await getSymbolsStoppedOutToday(sessionStart);
    const barsResponse = await alpaca.getBarsSince([...WATCHLIST], sessionStart);

    const scanRows: Array<{
      symbol: string;
      price: number | null;
      vwap: number | null;
      momentum_pct: number | null;
      volume_ratio: number | null;
      signal_met: boolean;
      skipped_reason: string | null;
    }> = [];

    let chosenSymbol: string | null = null;
    let chosenPrice: number | null = null;
    let chosenReasoning: string | null = null;

    for (const symbol of WATCHLIST) {
      const bars: AlpacaBar[] = barsResponse.bars[symbol] ?? [];

      if (stoppedOutToday.has(symbol)) {
        scanRows.push({
          symbol,
          price: bars.at(-1)?.c ?? null,
          vwap: null,
          momentum_pct: null,
          volume_ratio: null,
          signal_met: false,
          skipped_reason: "stopped_out_today",
        });
        continue;
      }

      const vwap = sessionVWAP(bars);
      const momentum = momentumPct(bars, SIGNAL.momentumLookbackBars);
      const volRatio = volumeRatio(bars, SIGNAL.volumeTrailingWindowBars);
      const price = bars.at(-1)?.c ?? null;

      const enoughData = vwap !== null && momentum !== null && volRatio !== null && price !== null;
      const priceAboveVwap = enoughData && price! > vwap!;
      const momentumMet = enoughData && momentum! >= SIGNAL.momentumThresholdPct;
      const volumeMet = enoughData && volRatio! >= SIGNAL.volumeRatioThreshold;
      const signalMet = Boolean(enoughData && priceAboveVwap && momentumMet && volumeMet);

      scanRows.push({
        symbol,
        price,
        vwap,
        momentum_pct: momentum,
        volume_ratio: volRatio,
        signal_met: signalMet,
        skipped_reason: enoughData ? null : "insufficient_bars",
      });

      if (signalMet && chosenSymbol === null) {
        chosenSymbol = symbol;
        chosenPrice = price;
        chosenReasoning = `price ${price!.toFixed(2)} > vwap ${vwap!.toFixed(2)}; momentum ${momentum!.toFixed(2)}% over ${SIGNAL.momentumLookbackBars} bars; volume ${volRatio!.toFixed(2)}x ${SIGNAL.volumeTrailingWindowBars}-bar avg`;
      }
    }

    await recordScanLog(scanRows);

    if (!chosenSymbol || chosenPrice === null) {
      return NextResponse.json({ ...log, action: "no_signal", scanned: scanRows.length });
    }

    // --- 5. Size and submit the bracket order. ---
    const dollarsToRisk = maxPositionDollars(trackedCash);
    const qty = Math.floor(dollarsToRisk / chosenPrice);

    if (qty < 1) {
      return NextResponse.json({
        ...log,
        action: "signal_but_position_too_small",
        symbol: chosenSymbol,
        dollarsToRisk,
        price: chosenPrice,
      });
    }

    const stopLossPrice = Number((chosenPrice * (1 - RISK.stopLossPct)).toFixed(2));
    const takeProfitPrice = Number((chosenPrice * (1 + RISK.takeProfitPct)).toFixed(2));

    const entryOrder = await alpaca.submitBracketOrder({
      symbol: chosenSymbol,
      qty,
      side: "buy",
      stopLossPrice,
      takeProfitPrice,
      clientOrderId: `${BOT_ID}-${chosenSymbol}-${Date.now()}`,
    });

    const position = await recordNewBracketPosition({
      symbol: chosenSymbol,
      qty,
      reasoning: chosenReasoning ?? "",
      entryOrder,
    });

    return NextResponse.json({
      ...log,
      action: "entered_position",
      symbol: chosenSymbol,
      qty,
      stopLossPrice,
      takeProfitPrice,
      positionId: position.id,
    });
  } catch (err) {
    return NextResponse.json(
      { ...log, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * A bracket leg filled and closed the position at Alpaca; figure out which
 * leg it was and record the exit. If neither leg shows a fill yet (e.g. we're
 * reading between the position closing and the leg's own status updating),
 * leaves the position open so the next cycle retries.
 */
async function reconcileClosedByBracketLeg(
  alpaca: ReturnType<typeof createAlpacaClientFromEnv>,
  openPosition: NonNullable<Awaited<ReturnType<typeof getOpenPosition>>>
) {
  const orderRowIds = [
    openPosition.entry_order_id,
    openPosition.stop_order_id,
    openPosition.take_profit_order_id,
  ].filter((id): id is string => id !== null);
  const orderRows = await getOrderRowsByIds(orderRowIds);
  const entryRow = orderRows.find((o) => o.leg === "entry");
  const stopRow = orderRows.find((o) => o.leg === "stop_loss");
  const takeProfitRow = orderRows.find((o) => o.leg === "take_profit");

  const [entryOrder, stopOrder, takeProfitOrder] = await Promise.all([
    entryRow?.alpaca_order_id ? alpaca.getOrder(entryRow.alpaca_order_id) : Promise.resolve(null),
    stopRow?.alpaca_order_id ? alpaca.getOrder(stopRow.alpaca_order_id) : Promise.resolve(null),
    takeProfitRow?.alpaca_order_id
      ? alpaca.getOrder(takeProfitRow.alpaca_order_id)
      : Promise.resolve(null),
  ]);

  const filledLeg =
    stopOrder?.status === "filled"
      ? { order: stopOrder, reason: "stop_loss" as const }
      : takeProfitOrder?.status === "filled"
        ? { order: takeProfitOrder, reason: "take_profit" as const }
        : null;

  if (filledLeg) {
    const exitPrice = filledLeg.order.filled_avg_price
      ? Number(filledLeg.order.filled_avg_price)
      : Number(openPosition.entry_price ?? 0);

    await closePosition({
      positionId: openPosition.id,
      exitPrice,
      exitReason: filledLeg.reason,
      closedAt: filledLeg.order.filled_at ?? new Date().toISOString(),
    });

    return { status: "closed", exitReason: filledLeg.reason, exitPrice };
  }

  // No leg filled — check whether the entry itself ever filled. If the
  // entry order was rejected/canceled/expired before ever filling, no
  // position was ever really opened; close the row out at zero P&L so a
  // dead order can't permanently block all future trading.
  const deadEntryStatuses = new Set(["rejected", "canceled", "expired", "done_for_day"]);
  if (entryOrder && deadEntryStatuses.has(entryOrder.status) && !entryOrder.filled_avg_price) {
    await closePosition({
      positionId: openPosition.id,
      exitPrice: 0,
      exitReason: "manual",
      closedAt: new Date().toISOString(),
    });
    return { status: "closed_dead_entry", entryStatus: entryOrder.status };
  }

  return { status: "position_gone_but_no_filled_leg_yet" };
}
