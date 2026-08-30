import { createPublicClient } from "@/lib/supabase/client";

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

const MAX_EQUITY_POINTS = 500;
const MAX_RECENT_TRADES = 20;

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
      .select("equity, cash")
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
  const currentEquity = latestEquityRes.data ? Number(latestEquityRes.data.equity) : currentCash;
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
