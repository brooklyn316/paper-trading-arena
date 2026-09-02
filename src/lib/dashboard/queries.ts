import { createPublicClient } from "@/lib/supabase/client";
import { marketDateString, marketDayBoundsUtc } from "@/lib/time";

export interface BotSummary {
  id: string;
  name: string;
  strategySummary: string | null;
  startingCash: number;
  isActive: boolean;
  currentEquity: number;
  currentCash: number;
  totalPnl: number;
  totalReturnPct: number;
  closedTradeCount: number;
  winRate: number | null; // null when there are no closed trades yet
}

export interface EquityPoint {
  ts: string;
  equity: number;
}

export interface OpenPositionSummary {
  symbol: string;
  qty: number;
  entryPrice: number | null;
  reasoning: string | null;
  openedAt: string;
}

export interface ClosedTradeSummary {
  id: string;
  symbol: string;
  qty: number;
  entryPrice: number | null;
  exitPrice: number | null;
  exitReason: string | null;
  realizedPnl: number | null;
  openedAt: string;
  closedAt: string | null;
}

export interface ScanRow {
  symbol: string;
  price: number | null;
  vwap: number | null;
  momentumPct: number | null;
  volumeRatio: number | null;
  signalMet: boolean;
  skippedReason: string | null;
}

export interface DashboardData {
  bot: BotSummary | null;
  equityHistory: EquityPoint[];
  openPosition: OpenPositionSummary | null;
  recentTrades: ClosedTradeSummary[];
  latestScan: { ts: string | null; rows: ScanRow[] };
  leaderboard: BotSummary[];
}

export interface TradingDaySummary {
  date: string; // "YYYY-MM-DD", market timezone
  startEquity: number;
  endEquity: number;
  pnl: number;
  pnlPct: number;
  tradeCount: number; // trades closed on this date
}

export interface ScanCycle {
  ts: string;
  rows: ScanRow[];
}

// Unlike ClosedTradeSummary (closed trades only, for the dashboard's "Recent
// trades" table), a day can contain a trade that opened and/or closed on it
// while still being open at the moment the page is viewed — so this carries
// status plus the entry reasoning, for a full "why did the bot do this" view.
export interface DayTrade {
  id: string;
  symbol: string;
  status: "open" | "closed";
  qty: number;
  entryPrice: number | null;
  exitPrice: number | null;
  exitReason: string | null;
  realizedPnl: number | null;
  reasoning: string | null;
  openedAt: string;
  closedAt: string | null;
}

export interface DayDetail {
  date: string;
  startEquity: number | null;
  endEquity: number | null;
  equityHistory: EquityPoint[];
  scanCycles: ScanCycle[];
  trades: DayTrade[];
}

const MAX_EQUITY_POINTS = 500;
const MAX_RECENT_TRADES = 20;
const MAX_HISTORY_ROWS = 20000;

/**
 * Everything the dashboard needs, in one round trip's worth of queries.
 * Read-only, via the publishable key + public-read RLS policies — never
 * given write access. Designed to degrade gracefully (nulls/empty arrays)
 * before the bot has ever traded, rather than throwing.
 */
export async function getDashboardData(botId: string): Promise<DashboardData> {
  const supabase = createPublicClient();

  const [botsRes, equityRes, openPositionRes, closedPositionsRes, latestScanTsRes] =
    await Promise.all([
      supabase.from("bots").select("*"),
      supabase
        .from("equity_ticks")
        .select("ts, equity")
        .eq("bot_id", botId)
        .order("ts", { ascending: false })
        .limit(MAX_EQUITY_POINTS),
      supabase
        .from("positions")
        .select("symbol, qty, entry_price, reasoning, opened_at")
        .eq("bot_id", botId)
        .eq("status", "open")
        .maybeSingle(),
      supabase
        .from("positions")
        .select("id, symbol, qty, entry_price, exit_price, exit_reason, realized_pnl, opened_at, closed_at")
        .eq("bot_id", botId)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(MAX_RECENT_TRADES),
      supabase
        .from("scan_log")
        .select("ts")
        .eq("bot_id", botId)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const bots = botsRes.data ?? [];
  const equityRows = (equityRes.data ?? []).slice().reverse(); // back to chronological order
  const closedPositions = closedPositionsRes.data ?? [];

  const leaderboard: BotSummary[] = await Promise.all(
    bots.map((b) => summarizeBot(supabase, b))
  );
  const bot = leaderboard.find((b) => b.id === botId) ?? null;

  let latestScanRows: ScanRow[] = [];
  const latestTs = latestScanTsRes.data?.ts ?? null;
  if (latestTs) {
    const { data } = await supabase
      .from("scan_log")
      .select("symbol, price, vwap, momentum_pct, volume_ratio, signal_met, skipped_reason")
      .eq("bot_id", botId)
      .eq("ts", latestTs);
    latestScanRows = (data ?? []).map((r) => ({
      symbol: r.symbol,
      price: r.price === null ? null : Number(r.price),
      vwap: r.vwap === null ? null : Number(r.vwap),
      momentumPct: r.momentum_pct === null ? null : Number(r.momentum_pct),
      volumeRatio: r.volume_ratio === null ? null : Number(r.volume_ratio),
      signalMet: r.signal_met,
      skippedReason: r.skipped_reason,
    }));
  }

  return {
    bot,
    equityHistory: equityRows.map((r) => ({ ts: r.ts, equity: Number(r.equity) })),
    openPosition: openPositionRes.data
      ? {
          symbol: openPositionRes.data.symbol,
          qty: Number(openPositionRes.data.qty),
          entryPrice:
            openPositionRes.data.entry_price === null ? null : Number(openPositionRes.data.entry_price),
          reasoning: openPositionRes.data.reasoning,
          openedAt: openPositionRes.data.opened_at,
        }
      : null,
    recentTrades: closedPositions.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      qty: Number(p.qty),
      entryPrice: p.entry_price === null ? null : Number(p.entry_price),
      exitPrice: p.exit_price === null ? null : Number(p.exit_price),
      exitReason: p.exit_reason,
      realizedPnl: p.realized_pnl === null ? null : Number(p.realized_pnl),
      openedAt: p.opened_at,
      closedAt: p.closed_at,
    })),
    latestScan: { ts: latestTs, rows: latestScanRows },
    leaderboard,
  };
}

async function summarizeBot(
  supabase: ReturnType<typeof createPublicClient>,
  bot: { id: string; name: string; strategy_summary: string | null; starting_cash: number; is_active: boolean }
): Promise<BotSummary> {
  const [latestEquityRes, closedRes] = await Promise.all([
    supabase
      .from("equity_ticks")
      .select("market_value")
      .eq("bot_id", bot.id)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("positions").select("realized_pnl").eq("bot_id", bot.id).eq("status", "closed"),
  ]);

  const startingCash = Number(bot.starting_cash);
  const closed = closedRes.data ?? [];
  const realizedTotal = closed.reduce((sum, p) => sum + Number(p.realized_pnl ?? 0), 0);
  const currentCash = startingCash + realizedTotal;
  // Equity = live cash + the open position's last-known market value — NOT
  // the stored `equity` column on the latest tick. That column bakes in
  // whatever starting_cash was true *when the cron last ran*, so it goes
  // stale (and badly misleading) the moment starting_cash changes by hand
  // and the market is closed — exactly what happened raising it to $10,000
  // over a weekend, where the last tick still reflected the old $500 base.
  const latestMarketValue = latestEquityRes.data ? Number(latestEquityRes.data.market_value) : 0;
  const currentEquity = currentCash + latestMarketValue;
  const totalPnl = currentEquity - startingCash;
  const wins = closed.filter((p) => Number(p.realized_pnl ?? 0) > 0).length;

  return {
    id: bot.id,
    name: bot.name,
    strategySummary: bot.strategy_summary,
    startingCash,
    isActive: bot.is_active,
    currentEquity,
    currentCash,
    totalPnl,
    totalReturnPct: startingCash > 0 ? (totalPnl / startingCash) * 100 : 0,
    closedTradeCount: closed.length,
    winRate: closed.length > 0 ? (wins / closed.length) * 100 : null,
  };
}

/**
 * One row per trading day the bot has any equity history for, most recent
 * first — the day list behind /history. Start/end equity come from the
 * first and last equity_ticks row of that ET calendar date (rows are fetched
 * ascending, so within a date group the last one seen is the day's close).
 * Bounded to MAX_HISTORY_ROWS equity ticks, which at one tick per 5-minute
 * cycle over a 6.5-hour session is ~78/day — plenty of runway before this
 * needs its own date-range pagination.
 */
export async function getTradingDays(botId: string): Promise<TradingDaySummary[]> {
  const supabase = createPublicClient();

  const [equityRes, closedRes] = await Promise.all([
    supabase
      .from("equity_ticks")
      .select("ts, equity")
      .eq("bot_id", botId)
      .order("ts", { ascending: true })
      .limit(MAX_HISTORY_ROWS),
    supabase
      .from("positions")
      .select("closed_at")
      .eq("bot_id", botId)
      .eq("status", "closed")
      .not("closed_at", "is", null),
  ]);

  const byDate = new Map<string, { start: number; end: number }>();
  for (const row of equityRes.data ?? []) {
    const date = marketDateString(new Date(row.ts));
    const equity = Number(row.equity);
    const existing = byDate.get(date);
    if (existing) {
      existing.end = equity;
    } else {
      byDate.set(date, { start: equity, end: equity });
    }
  }

  const tradeCountByDate = new Map<string, number>();
  for (const row of closedRes.data ?? []) {
    if (!row.closed_at) continue;
    const date = marketDateString(new Date(row.closed_at));
    tradeCountByDate.set(date, (tradeCountByDate.get(date) ?? 0) + 1);
  }

  const days: TradingDaySummary[] = Array.from(byDate.entries()).map(([date, { start, end }]) => {
    const pnl = end - start;
    return {
      date,
      startEquity: start,
      endEquity: end,
      pnl,
      pnlPct: start > 0 ? (pnl / start) * 100 : 0,
      tradeCount: tradeCountByDate.get(date) ?? 0,
    };
  });

  days.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return days;
}

/**
 * Everything that happened on one ET calendar date: every equity tick, every
 * scan cycle (grouped by timestamp, every symbol whether or not it signaled),
 * and every trade that opened and/or closed that day (including one still
 * open at view time). Returns empty arrays for a date with no rows rather
 * than throwing — a valid date with no trading activity (a holiday, or one
 * outside the bot's history) is not an error.
 */
export async function getDayDetail(botId: string, date: string): Promise<DayDetail> {
  const supabase = createPublicClient();
  const { startUtcISO, endUtcISO } = marketDayBoundsUtc(date);

  const [equityRes, scanRes, positionsRes] = await Promise.all([
    supabase
      .from("equity_ticks")
      .select("ts, equity")
      .eq("bot_id", botId)
      .gte("ts", startUtcISO)
      .lt("ts", endUtcISO)
      .order("ts", { ascending: true }),
    supabase
      .from("scan_log")
      .select("ts, symbol, price, vwap, momentum_pct, volume_ratio, signal_met, skipped_reason")
      .eq("bot_id", botId)
      .gte("ts", startUtcISO)
      .lt("ts", endUtcISO)
      .order("ts", { ascending: true }),
    supabase
      .from("positions")
      .select(
        "id, symbol, qty, entry_price, exit_price, exit_reason, realized_pnl, reasoning, opened_at, closed_at, status"
      )
      .eq("bot_id", botId)
      .or(
        `and(opened_at.gte.${startUtcISO},opened_at.lt.${endUtcISO}),and(closed_at.gte.${startUtcISO},closed_at.lt.${endUtcISO})`
      )
      .order("opened_at", { ascending: true }),
  ]);

  const equityRows = equityRes.data ?? [];

  const cyclesByTs = new Map<string, ScanRow[]>();
  for (const r of scanRes.data ?? []) {
    const row: ScanRow = {
      symbol: r.symbol,
      price: r.price === null ? null : Number(r.price),
      vwap: r.vwap === null ? null : Number(r.vwap),
      momentumPct: r.momentum_pct === null ? null : Number(r.momentum_pct),
      volumeRatio: r.volume_ratio === null ? null : Number(r.volume_ratio),
      signalMet: r.signal_met,
      skippedReason: r.skipped_reason,
    };
    const list = cyclesByTs.get(r.ts);
    if (list) list.push(row);
    else cyclesByTs.set(r.ts, [row]);
  }
  const scanCycles: ScanCycle[] = Array.from(cyclesByTs.entries())
    .map(([ts, rows]) => ({ ts, rows }))
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  const trades: DayTrade[] = (positionsRes.data ?? []).map((p) => ({
    id: p.id,
    symbol: p.symbol,
    status: p.status === "open" ? "open" : "closed",
    qty: Number(p.qty),
    entryPrice: p.entry_price === null ? null : Number(p.entry_price),
    exitPrice: p.exit_price === null ? null : Number(p.exit_price),
    exitReason: p.exit_reason,
    realizedPnl: p.realized_pnl === null ? null : Number(p.realized_pnl),
    reasoning: p.reasoning,
    openedAt: p.opened_at,
    closedAt: p.closed_at,
  }));

  return {
    date,
    startEquity: equityRows.length > 0 ? Number(equityRows[0].equity) : null,
    endEquity: equityRows.length > 0 ? Number(equityRows[equityRows.length - 1].equity) : null,
    equityHistory: equityRows.map((r) => ({ ts: r.ts, equity: Number(r.equity) })),
    scanCycles,
    trades,
  };
}
