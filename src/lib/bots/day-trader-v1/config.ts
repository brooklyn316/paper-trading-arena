/**
 * day-trader-v1 — fixed strategy constants. Nothing here should be read
 * from the database; the bot's rules are code, not configuration, so a
 * change to the strategy is a deploy, not a data edit.
 */

export const BOT_ID = "day-trader-v1";

export const WATCHLIST = [
  "AAPL",
  "MSFT",
  "NVDA",
  "TSLA",
  "AMD",
  "META",
  "AMZN",
  "GOOGL",
  "SPY",
  "QQQ",
] as const;

export const SIGNAL = {
  // Momentum: close must be up at least this % over the lookback window.
  momentumLookbackBars: 3,
  momentumThresholdPct: 0.5,
  // Volume: current bar's volume must be at least this multiple of the
  // trailing average.
  volumeTrailingWindowBars: 20,
  volumeRatioThreshold: 1.5,
};

export const RISK = {
  // Documentation only — the real, authoritative starting cash lives in the
  // Supabase `bots.starting_cash` column (see db.ts's getCurrentTrackedCash),
  // since that's what already survived the original $500 -> $10,000 change
  // without a code deploy. Keep this in sync so it doesn't mislead.
  startingCash: 10000,
  // Max fraction of the bot's tracked portfolio value risked per trade.
  maxPositionPct: 0.4,
  // Hard dollar cap, applied in addition to the pct cap. Scaled with the
  // $10,000 starting cash (40% of it) so it isn't a silent bottleneck like
  // it was at $200 on the old $500 budget, where it made every watchlist
  // symbol unaffordable regardless of the pct rule.
  maxPositionDollars: 4000,
  stopLossPct: 0.01, // 1% below entry
  takeProfitPct: 0.02, // 2% above entry (2:1 reward/risk)
};
