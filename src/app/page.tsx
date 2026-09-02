import Link from "next/link";
import { getDashboardData } from "@/lib/dashboard/queries";
import EquityChart from "@/components/EquityChart";
import StatTile from "@/components/StatTile";
import {
  formatCurrency,
  formatSignedCurrency,
  formatCompactCurrency,
  formatCompactSignedCurrency,
  formatPct,
  formatDateTime,
} from "@/lib/dashboard/format";

// Only one bot exists today, but the schema and this page are both
// multi-bot-ready (bot_id everywhere, a leaderboard table below) — this is
// just the featured bot until there's a /bot/[id] route to pick among many.
const FEATURED_BOT_ID = "day-trader-v1";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const data = await getDashboardData(FEATURED_BOT_ID);
  const { bot, equityHistory, openPosition, recentTrades, latestScan, leaderboard } = data;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Paper Trading Arena</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Algorithmic bots trading Alpaca paper accounts, tracked against their own simulated
            budgets — not Alpaca&apos;s $100,000 default balance.
          </p>
        </div>
        <Link
          href="/history"
          className="shrink-0 whitespace-nowrap rounded-md border border-[var(--chart-border)] px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          Full history →
        </Link>
      </header>

      {!bot ? (
        <div className="rounded-lg border border-[var(--chart-border)] bg-[var(--chart-surface)] p-6 text-sm text-[var(--text-secondary)]">
          No bot data yet.
        </div>
      ) : (
        <>
          <section className="mb-6 flex items-center justify-between rounded-lg border border-[var(--chart-border)] bg-[var(--chart-surface)] p-4">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: bot.isActive ? "var(--status-good)" : "var(--text-muted)" }}
                />
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">{bot.name}</h2>
                <span className="text-xs text-[var(--text-muted)]">({bot.id})</span>
              </div>
              {bot.strategySummary && (
                <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">{bot.strategySummary}</p>
              )}
            </div>
          </section>

          <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Equity" value={formatCompactCurrency(bot.currentEquity)} title={formatCurrency(bot.currentEquity)} />
            <StatTile label="Cash" value={formatCompactCurrency(bot.currentCash)} title={formatCurrency(bot.currentCash)} />
            <StatTile
              label="Total P&L"
              value={formatCompactSignedCurrency(bot.totalPnl)}
              title={formatSignedCurrency(bot.totalPnl)}
              delta={formatPct(bot.totalReturnPct)}
              deltaGood={bot.totalPnl >= 0}
            />
            <StatTile label="Starting cash" value={formatCompactCurrency(bot.startingCash)} title={formatCurrency(bot.startingCash)} />
            <StatTile
              label="Win rate"
              value={bot.winRate === null ? "—" : `${bot.winRate.toFixed(0)}%`}
            />
            <StatTile label="Trades" value={String(bot.closedTradeCount)} />
          </section>

          <section className="mb-6 rounded-lg border border-[var(--chart-border)] bg-[var(--chart-surface)] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Equity curve</h3>
            <EquityChart points={equityHistory} startingCash={bot.startingCash} />
          </section>

          <section className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--chart-border)] bg-[var(--chart-surface)] p-4">
              <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Open position</h3>
              {openPosition ? (
                <div className="text-sm">
                  <div className="text-lg font-semibold text-[var(--text-primary)]">
                    {openPosition.symbol} · {openPosition.qty} sh
                  </div>
                  <div className="mt-1 text-[var(--text-secondary)]">
                    Entry:{" "}
                    {openPosition.entryPrice === null ? (
                      <span className="text-[var(--text-muted)]">pending fill</span>
                    ) : (
                      formatCurrency(openPosition.entryPrice)
                    )}
                  </div>
                  <div className="text-[var(--text-muted)]">Opened {formatDateTime(openPosition.openedAt)}</div>
                  {openPosition.reasoning && (
                    <div className="mt-2 text-xs text-[var(--text-muted)]">{openPosition.reasoning}</div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">No open position right now.</p>
              )}
            </div>

            <div className="rounded-lg border border-[var(--chart-border)] bg-[var(--chart-surface)] p-4">
              <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                Latest scan{latestScan.ts && <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">{formatDateTime(latestScan.ts)}</span>}
              </h3>
              {latestScan.rows.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No scans yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[var(--text-muted)]">
                        <th className="py-1 pr-2 font-normal">Symbol</th>
                        <th className="py-1 pr-2 font-normal">Price</th>
                        <th className="py-1 pr-2 font-normal">vs VWAP</th>
                        <th className="py-1 pr-2 font-normal">Momentum</th>
                        <th className="py-1 pr-2 font-normal">Vol ratio</th>
                        <th className="py-1 font-normal">Signal</th>
                      </tr>
                    </thead>
                    <tbody className="[font-variant-numeric:tabular-nums]">
                      {latestScan.rows.map((row) => (
                        <tr key={row.symbol} className="border-t border-[var(--chart-border)]">
                          <td className="py-1 pr-2 font-medium text-[var(--text-primary)]">{row.symbol}</td>
                          <td className="py-1 pr-2 text-[var(--text-secondary)]">
                            {row.price === null ? "—" : formatCurrency(row.price)}
                          </td>
                          <td className="py-1 pr-2 text-[var(--text-secondary)]">
                            {row.price === null || row.vwap === null
                              ? "—"
                              : formatPct(((row.price - row.vwap) / row.vwap) * 100)}
                          </td>
                          <td className="py-1 pr-2 text-[var(--text-secondary)]">
                            {row.momentumPct === null ? "—" : formatPct(row.momentumPct)}
                          </td>
                          <td className="py-1 pr-2 text-[var(--text-secondary)]">
                            {row.volumeRatio === null ? "—" : `${row.volumeRatio.toFixed(2)}x`}
                          </td>
                          <td className="py-1">
                            {row.signalMet ? (
                              <span style={{ color: "var(--status-good)" }}>met</span>
                            ) : (
                              <span className="text-[var(--text-muted)]">
                                {row.skippedReason ?? "no"}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section className="mb-6 rounded-lg border border-[var(--chart-border)] bg-[var(--chart-surface)] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Recent trades</h3>
            {recentTrades.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No closed trades yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--text-muted)]">
                      <th className="py-1 pr-3 font-normal">Symbol</th>
                      <th className="py-1 pr-3 font-normal">Qty</th>
                      <th className="py-1 pr-3 font-normal">Entry</th>
                      <th className="py-1 pr-3 font-normal">Exit</th>
                      <th className="py-1 pr-3 font-normal">Reason</th>
                      <th className="py-1 pr-3 font-normal">P&amp;L</th>
                      <th className="py-1 font-normal">Closed</th>
                    </tr>
                  </thead>
                  <tbody className="[font-variant-numeric:tabular-nums]">
                    {recentTrades.map((t) => (
                      <tr key={t.id} className="border-t border-[var(--chart-border)]">
                        <td className="py-1.5 pr-3 font-medium text-[var(--text-primary)]">{t.symbol}</td>
                        <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{t.qty}</td>
                        <td className="py-1.5 pr-3 text-[var(--text-secondary)]">
                          {t.entryPrice === null ? "—" : formatCurrency(t.entryPrice)}
                        </td>
                        <td className="py-1.5 pr-3 text-[var(--text-secondary)]">
                          {t.exitPrice === null ? "—" : formatCurrency(t.exitPrice)}
                        </td>
                        <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{t.exitReason ?? "—"}</td>
                        <td
                          className="py-1.5 pr-3 font-medium"
                          style={{
                            color:
                              t.realizedPnl === null
                                ? "var(--text-secondary)"
                                : t.realizedPnl >= 0
                                  ? "var(--status-good)"
                                  : "var(--status-critical)",
                          }}
                        >
                          {t.realizedPnl === null ? "—" : formatSignedCurrency(t.realizedPnl)}
                        </td>
                        <td className="py-1.5 text-[var(--text-muted)]">
                          {t.closedAt ? formatDateTime(t.closedAt) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[var(--chart-border)] bg-[var(--chart-surface)] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Leaderboard</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text-muted)]">
                    <th className="py-1 pr-3 font-normal">Bot</th>
                    <th className="py-1 pr-3 font-normal">Equity</th>
                    <th className="py-1 pr-3 font-normal">Return</th>
                    <th className="py-1 pr-3 font-normal">Trades</th>
                    <th className="py-1 font-normal">Win rate</th>
                  </tr>
                </thead>
                <tbody className="[font-variant-numeric:tabular-nums]">
                  {leaderboard
                    .slice()
                    .sort((a, b) => b.totalReturnPct - a.totalReturnPct)
                    .map((b) => (
                      <tr key={b.id} className="border-t border-[var(--chart-border)]">
                        <td className="py-1.5 pr-3 font-medium text-[var(--text-primary)]">{b.name}</td>
                        <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{formatCurrency(b.currentEquity)}</td>
                        <td
                          className="py-1.5 pr-3 font-medium"
                          style={{ color: b.totalReturnPct >= 0 ? "var(--status-good)" : "var(--status-critical)" }}
                        >
                          {formatPct(b.totalReturnPct)}
                        </td>
                        <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{b.closedTradeCount}</td>
                        <td className="py-1.5 text-[var(--text-secondary)]">
                          {b.winRate === null ? "—" : `${b.winRate.toFixed(0)}%`}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          <footer className="mt-8 text-xs text-[var(--text-muted)]">
            Paper trading only — Alpaca IEX feed, 5-minute bars. Refresh to see the latest data.
          </footer>
        </>
      )}
    </main>
  );
}
