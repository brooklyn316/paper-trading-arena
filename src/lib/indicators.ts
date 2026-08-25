import { AlpacaBar } from "./alpaca/types";

/**
 * Volume-weighted average price across every bar since session open.
 * sum(bar.vw * bar.v) / sum(bar.v) over ALL bars provided — callers must
 * pass every bar since 9:30am ET, not just a recent window.
 */
export function sessionVWAP(bars: AlpacaBar[]): number | null {
  if (bars.length === 0) return null;
  let volumeWeightedSum = 0;
  let totalVolume = 0;
  for (const bar of bars) {
    volumeWeightedSum += bar.vw * bar.v;
    totalVolume += bar.v;
  }
  if (totalVolume === 0) return null;
  return volumeWeightedSum / totalVolume;
}

/**
 * % price change over the last `lookback` bars, comparing the close of the
 * most recent bar to the close `lookback` bars ago. Returns null if there
 * aren't enough bars yet.
 */
export function momentumPct(bars: AlpacaBar[], lookback = 3): number | null {
  if (bars.length < lookback + 1) return null;
  const recent = bars[bars.length - 1];
  const past = bars[bars.length - 1 - lookback];
  if (past.c === 0) return null;
  return ((recent.c - past.c) / past.c) * 100;
}

/**
 * Ratio of the current (most recent) bar's volume to the trailing average
 * volume of the `trailingWindow` bars before it. Returns null if there
 * aren't enough prior bars yet.
 */
export function volumeRatio(bars: AlpacaBar[], trailingWindow = 20): number | null {
  if (bars.length < trailingWindow + 1) return null;
  const currentBar = bars[bars.length - 1];
  const trailingBars = bars.slice(
    bars.length - 1 - trailingWindow,
    bars.length - 1
  );
  const avgVolume =
    trailingBars.reduce((sum, b) => sum + b.v, 0) / trailingBars.length;
  if (avgVolume === 0) return null;
  return currentBar.v / avgVolume;
}
