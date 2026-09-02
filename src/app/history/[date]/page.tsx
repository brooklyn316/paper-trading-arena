import Link from "next/link";
import { getDayDetail, getTradingDays } from "@/lib/dashboard/queries";
import EquityChart from "@/components/EquityChart";
import StatTile from "@/components/StatTile";
import {
  formatCurrency,
  formatSignedCurrency,
  formatCompactCurrency,
  formatCompactSignedCurrency,
  formatPct,
  formatTime,
  formatDayHeading,
} from "@/lib/dashboard/format";

const FEATURED_BOT_ID = "day-trader-v1";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const dynamic = "force-dynamic";
export const revalidate = 0;

function statusColor(good: boolean) {
  return good ? "var(--status-good)" : "var(--status-critical)";
}

export default async function DayDetailPage({ params }: { params: { date: string } }) {
  const { date } = params;

  if (!DATE_RE.test(date)) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Link href="/history" className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          ← Back to history
        </Link>
        <p className="mt-4 text-sm text-[var(--text-secondary)]">
          &quot;{date}&quot; isn&apos;t a valid date — expected YYYY-MM-DD.
        </p>
      </main>
    );
  }

  const [detail, allDays] = await Promise.all([
    getDayDetail(FEATURED_BOT_ID, date),
    getTradingDays(FEATURED_BOT_ID),
  ]);

  // allDays is sorted most-recent-first, so the day before this one (in
  // trading-calendar order) is the next array entry, and the day after is
  // the previous entry.
  const idx = allDays.findIndex((d) => d.date === date);
  const prevDate = idx >= 0 && idx < allDays.length - 1 ? allDays[idx + 1].date : null;
  const nextDate = idx > 0 ? allDays[idx - 1].date : null;

  const hasActivity = detail.equityHistory.length > 0 || detail.scanCycles.length > 0 || detail.trades.length > 0;
  const pnl = detail.startEquity !== null && detail.endEquity !== null ? detail.endEquity - detail.startEquity : null;
  const pnlPct = pnl !== null && detail.startEquity ? (pnl / detail.startEquity) * 100 : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <Link href="/history" className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          ← Back to history
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{formatDayHeading(date)}</h1>
          <div className="flex items-center gap-3 text-sm">
            {prevDate ? (
              <Link href={`/history/${prevDate}`} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                ← Prev day
              </Link>
            ) : (
              <span className="text-[var(--text-muted)]">← Prev day</span>
            )}
            {nextDate ? (
              <Link href={`/history/${nextDate}`} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                Next day →
              </Link>
            ) : (
              <span className="text-[var(--text-muted)]">Next day →</span>
            )}
          </div>
        </div>
      </header>

      {!hasActivity ? (
        <div className="rounded-lg border border-[var(--chart-border)] bg-[var(--chart-surface)] p-6 text-sm text-[var(--text-secondary)]">
          No activity recorded for this day.
        </div>
      ) : (
        <>
          <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="Start equity"
              value={detail.startEquity === null ? "—" : formatCompactCurrency(detail.startEquity)}
              title={detail.startEquity === null ? undefined : formatCurrency(detail.startEquity)}
            />
            <StatTile
              label="End equity"
              value={detail.endEquity === null ? "—" : formatCompactCurrency(detail.endEquity)}
              title={detail.endEquity === null ? undefined : formatCurrency(detail.endEquity)}
            />
            <StatTile
              label="Day P&L"
              value={pnl === null ? "—" : formatCompactSignedCurrency(pnl)}
              title={pnl === null ? undefined : formatSignedCurrency(pnl)}
              delta={pnlPct === null ? undefined : formatPct(pnlPct)}
              deltaGood={pnl !== null && pnl >= 0}
            />
            <StatTile label="Trades" value={String(detail.trades.length)} />
          </section>

          <section className="mb-6 rounded-lg border border-[var(--chart-border)] bg-[var(--chart-surface)] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Equity curve</h3>
            <EquityChart points={detail.equityHistory} startingCash={detail.startEquity ?? 0} />
          </section>

          <section className="mb-6 rounded-lg border border-[var(--chart-border)] bg-[var(--chart-surface)] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
              Trades{" "}
              <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">
                every position opened and/or closed this day
              </span>
            </h3>
            {detail.trades.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No trades this day.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {detail.trades.map((t) => (
                  <div key={t.id} className="rounded-md border border-[var(--chart-border)] p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: t.status === "open" ? "var(--status-good)" : "var(--text-muted)" }}
                        />
                        <span className="font-semibold text-[var(--text-primary)]">{t.symbol}</span>
                        <span className="text-[var(--text-secondary)]">{t.qty} sh</span>
                        <span className="text-xs text-[var(--text-muted)]">
                          {t.status === "open" ? "still open" : "closed"}
                        </span>
                      </div>
                      <div
                        className="font-medium [font-variant-numeric:tabular-nums]"
                        style={{ color: t.realizedPnl === null ? "var(--text-secondary)" : statusColor(t.realizedPnl >= 0) }}
                      >
                        {t.realizedPnl === null ? "—" : formatSignedCurrency(t.realizedPnl)}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
                      <div>
                        Opened {formatTime(t.openedAt)} at{" "}
                        {t.entryPrice === null ? (
                          <span className="text-[var(--text-muted)]">pending fill</span>
                        ) : (
                          formatCurrency(t.entryPrice)
                        )}
                      </div>
                      {t.closedAt && (
                        <div>
                          Closed {formatTime(t.closedAt)} at{" "}
                          {t.exitPrice === null ? "—" : formatCurrency(t.exitPrice)}
                          {t.exitReason && <span className="text-[var(--text-muted)]"> — {t.exitReason}</span>}
                        </div>
                      )}
                    </div>
                    {t.reasoning && (
                      <div className="mt-2 text-xs text-[var(--text-muted)]">{t.reasoning}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[var(--chart-border)] bg-[var(--chart-surface)] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
              Scan cycles{" "}
              <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">
                {detail.scanCycles.length} cycles — every symbol scanned every 5 minutes, whether or
                not it signaled
              </span>
            </h3>
            {detail.scanCycles.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No scans recorded this day.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {detail.scanCycles.map((cycle) => {
                  const signalCount = cycle.rows.filter((r) => r.signalMet).length;
                  return (
                    <details key={cycle.ts} open={signalCount > 0} className="group">
                      <summary className="cursor-pointer select-none rounded-md py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--chart-gridline)]">
                        <span className="font-medium text-[var(--text-primary)]">{formatTime(cycle.ts)}</span>{" "}
                        {signalCount > 0 ? (
                          <span style={{ color: "var(--status-good)" }}>
                            {signalCount} signal{signalCount > 1 ? "s" : ""} met
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">no signals</span>
                        )}
                      </summary>
                      <div className="overflow-x-auto pb-2 pl-2">
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
                            {cycle.rows.map((row) => (
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
                                    <span className="text-[var(--text-muted)]">{row.skippedReason ?? "no"}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
