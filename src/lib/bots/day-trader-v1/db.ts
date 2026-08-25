import { createServiceClient } from "@/lib/supabase/server";
import { AlpacaOrder } from "@/lib/alpaca/types";
import { BOT_ID, RISK } from "./config";

export interface PositionRow {
  id: string;
  bot_id: string;
  symbol: string;
  qty: number;
  entry_price: number | null;
  entry_order_id: string | null;
  stop_order_id: string | null;
  take_profit_order_id: string | null;
  exit_order_id: string | null;
  exit_price: number | null;
  status: "open" | "closed";
  exit_reason: "stop_loss" | "take_profit" | "force_close" | "manual" | null;
  realized_pnl: number | null;
  reasoning: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface OrderRow {
  id: string;
  bot_id: string;
  alpaca_order_id: string | null;
  position_id: string | null;
  symbol: string;
  side: "buy" | "sell";
  order_class: "bracket" | "market";
  leg: "entry" | "stop_loss" | "take_profit" | "force_close";
  qty: number;
  limit_price: number | null;
  stop_price: number | null;
  status: string;
}

/** The one open position for this bot, or null. Enforces "one position at a time". */
export async function getOpenPosition(botId = BOT_ID): Promise<PositionRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("positions")
    .select("*")
    .eq("bot_id", botId)
    .eq("status", "open")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Symbols that were stopped out today (opened today, exited via stop_loss).
 * Used to enforce "no re-entry on a symbol after a same-day stop-out."
 */
export async function getSymbolsStoppedOutToday(
  sessionStartISO: string,
  botId = BOT_ID
): Promise<Set<string>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("positions")
    .select("symbol")
    .eq("bot_id", botId)
    .eq("exit_reason", "stop_loss")
    .gte("opened_at", sessionStartISO);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.symbol as string));
}

/**
 * The bot's tracked cash: starting_cash + sum of realized P&L on closed
 * positions. Deliberately NEVER reads Alpaca's real account balance, which
 * defaults to $100,000 and has no concept of this bot's $500 budget.
 */
export async function getCurrentTrackedCash(botId = BOT_ID): Promise<number> {
  const supabase = createServiceClient();
  const [botRes, positionsRes] = await Promise.all([
    supabase.from("bots").select("starting_cash").eq("id", botId).single(),
    supabase.from("positions").select("realized_pnl").eq("bot_id", botId).eq("status", "closed"),
  ]);
  if (botRes.error) throw botRes.error;
  if (positionsRes.error) throw positionsRes.error;

  const realizedTotal = (positionsRes.data ?? []).reduce(
    (sum, p) => sum + Number(p.realized_pnl ?? 0),
    0
  );
  return Number(botRes.data.starting_cash) + realizedTotal;
}

/** Max dollars to risk on the next trade, given current tracked cash. */
export function maxPositionDollars(trackedCash: number): number {
  return Math.min(trackedCash * RISK.maxPositionPct, RISK.maxPositionDollars, trackedCash);
}

export async function recordScanLog(
  rows: Array<{
    symbol: string;
    price: number | null;
    vwap: number | null;
    momentum_pct: number | null;
    volume_ratio: number | null;
    signal_met: boolean;
    skipped_reason: string | null;
  }>,
  botId = BOT_ID
): Promise<void> {
  if (rows.length === 0) return;
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("scan_log")
    .insert(rows.map((r) => ({ ...r, bot_id: botId })));
  if (error) throw error;
}

/**
 * Records a brand-new position + its three bracket order legs after
 * successfully submitting the bracket order to Alpaca. entry_price is left
 * null — the entry is a market order, so the real fill price is confirmed
 * on a later cycle's reconciliation pass.
 */
export async function recordNewBracketPosition(params: {
  symbol: string;
  qty: number;
  reasoning: string;
  entryOrder: AlpacaOrder;
  botId?: string;
}): Promise<PositionRow> {
  const botId = params.botId ?? BOT_ID;
  const supabase = createServiceClient();

  const { data: position, error: positionError } = await supabase
    .from("positions")
    .insert({
      bot_id: botId,
      symbol: params.symbol,
      qty: params.qty,
      status: "open",
      reasoning: params.reasoning,
    })
    .select("*")
    .single();
  if (positionError) throw positionError;

  const legs = params.entryOrder.legs ?? [];
  const stopLeg = legs.find((l) => l.type === "stop") ?? null;
  const takeProfitLeg = legs.find((l) => l.type === "limit") ?? null;

  const orderRowsToInsert = [
    {
      bot_id: botId,
      alpaca_order_id: params.entryOrder.id,
      position_id: position.id,
      symbol: params.symbol,
      side: "buy" as const,
      order_class: "bracket" as const,
      leg: "entry" as const,
      qty: params.qty,
      status: mapAlpacaStatus(params.entryOrder.status),
      submitted_at: params.entryOrder.submitted_at,
      raw: params.entryOrder,
    },
    ...(stopLeg
      ? [
          {
            bot_id: botId,
            alpaca_order_id: stopLeg.id,
            position_id: position.id,
            symbol: params.symbol,
            side: "sell" as const,
            order_class: "bracket" as const,
            leg: "stop_loss" as const,
            qty: params.qty,
            stop_price: stopLeg.stop_price ? Number(stopLeg.stop_price) : null,
            status: mapAlpacaStatus(stopLeg.status),
            submitted_at: stopLeg.submitted_at,
            raw: stopLeg,
          },
        ]
      : []),
    ...(takeProfitLeg
      ? [
          {
            bot_id: botId,
            alpaca_order_id: takeProfitLeg.id,
            position_id: position.id,
            symbol: params.symbol,
            side: "sell" as const,
            order_class: "bracket" as const,
            leg: "take_profit" as const,
            qty: params.qty,
            limit_price: takeProfitLeg.limit_price ? Number(takeProfitLeg.limit_price) : null,
            status: mapAlpacaStatus(takeProfitLeg.status),
            submitted_at: takeProfitLeg.submitted_at,
            raw: takeProfitLeg,
          },
        ]
      : []),
  ];

  const { data: insertedOrders, error: ordersError } = await supabase
    .from("orders")
    .insert(orderRowsToInsert)
    .select("id, leg");
  if (ordersError) throw ordersError;

  const entryOrderRow = insertedOrders.find((o) => o.leg === "entry");
  const stopOrderRow = insertedOrders.find((o) => o.leg === "stop_loss");
  const takeProfitOrderRow = insertedOrders.find((o) => o.leg === "take_profit");

  const { data: updatedPosition, error: updateError } = await supabase
    .from("positions")
    .update({
      entry_order_id: entryOrderRow?.id ?? null,
      stop_order_id: stopOrderRow?.id ?? null,
      take_profit_order_id: takeProfitOrderRow?.id ?? null,
    })
    .eq("id", position.id)
    .select("*")
    .single();
  if (updateError) throw updateError;

  return updatedPosition;
}

/** Backfills the real fill price once Alpaca confirms the entry order filled. */
export async function backfillEntryFill(
  positionId: string,
  entryOrderRowId: string,
  fillPrice: number,
  filledAt: string
): Promise<void> {
  const supabase = createServiceClient();
  const [positionUpdate, orderUpdate] = await Promise.all([
    supabase.from("positions").update({ entry_price: fillPrice }).eq("id", positionId),
    supabase
      .from("orders")
      .update({ status: "filled", filled_avg_price: fillPrice, filled_at: filledAt })
      .eq("id", entryOrderRowId),
  ]);
  if (positionUpdate.error) throw positionUpdate.error;
  if (orderUpdate.error) throw orderUpdate.error;
}

/** Closes a position: sets exit price/reason/realized P&L and marks it closed. */
export async function closePosition(params: {
  positionId: string;
  exitPrice: number;
  exitReason: "stop_loss" | "take_profit" | "force_close" | "manual";
  closedAt: string;
  exitOrderId?: string | null;
}): Promise<PositionRow> {
  const supabase = createServiceClient();
  const { data: position, error: fetchError } = await supabase
    .from("positions")
    .select("*")
    .eq("id", params.positionId)
    .single();
  if (fetchError) throw fetchError;

  const entryPrice = position.entry_price ?? params.exitPrice;
  const realizedPnl = (params.exitPrice - Number(entryPrice)) * Number(position.qty);

  const { data: updated, error: updateError } = await supabase
    .from("positions")
    .update({
      status: "closed",
      exit_price: params.exitPrice,
      exit_reason: params.exitReason,
      realized_pnl: realizedPnl,
      closed_at: params.closedAt,
      exit_order_id: params.exitOrderId ?? null,
      entry_price: entryPrice,
    })
    .eq("id", params.positionId)
    .select("*")
    .single();
  if (updateError) throw updateError;
  return updated;
}

/** Fetches order rows by their internal ids (e.g. a position's stop_order_id / take_profit_order_id). */
export async function getOrderRowsByIds(ids: string[]): Promise<OrderRow[]> {
  if (ids.length === 0) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("orders").select("*").in("id", ids);
  if (error) throw error;
  return data ?? [];
}

export async function updateOrderStatusByAlpacaId(
  alpacaOrderId: string,
  fields: { status?: string; filled_avg_price?: number | null; filled_at?: string | null }
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("orders")
    .update(fields)
    .eq("alpaca_order_id", alpacaOrderId);
  if (error) throw error;
}

export async function recordEquityTick(params: {
  cash: number;
  marketValue: number;
  botId?: string;
}): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("equity_ticks").insert({
    bot_id: params.botId ?? BOT_ID,
    cash: params.cash,
    market_value: params.marketValue,
    equity: params.cash + params.marketValue,
  });
  if (error) throw error;
}

/** Alpaca order statuses are a superset of what we bothered to model precisely. */
function mapAlpacaStatus(status: string): string {
  const known = new Set([
    "new",
    "held",
    "accepted",
    "pending_new",
    "filled",
    "partially_filled",
    "canceled",
    "pending_cancel",
    "rejected",
    "expired",
    "done_for_day",
    "replaced",
    "stopped",
    "suspended",
    "calculated",
  ]);
  return known.has(status) ? status : "new";
}
