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
  startingCash: 500,
  // Max fraction of the bot's tracked portfolio value risked per trade.
  maxPositionPct: 0.4,
  // Hard dollar cap, applied in addition to the pct cap (on $500 starting
  // cash these are the same number, but the pct cap is what scales if the
  // ledger grows or shrinks).
  maxPositionDollars: 200,
  stopLossPct: 0.01, // 1% below entry
  takeProfitPct: 0.02, // 2% above entry (2:1 reward/risk)
};
