import Link from "next/link";
import { getTradingDays } from "@/lib/dashboard/queries";
import { formatCurrency, formatSignedCurrency, formatPct, formatDayHeading } from "@/lib/dashboard/format";

// Same featured-bot placeholder as the main dashboard — see page.tsx.
const FEATURED_BOT_ID = "day-trader-v1";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HistoryPage() {
  const days = await getTradingDays(FEATURED_BOT_ID);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <Link href="/" className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">Trading history</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          One row per trading day. Open a day to see every scan cycle and every trade behind it.
        </p>
      </header>

      {days.length === 0 ? (
        <div className="rounded-lg border border-[var(--chart-border)] bg-[var(--chart-surface)] p-6 text-sm text-[var(--text-secondary)]">
          No trading days yet — this fills in once the bot starts running.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--chart-border)] bg-[var(--chart-surface)] p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-muted)]">
                <th className="py-1 pr-3 font-normal">Date</th>
                <th className="py-1 pr-3 font-normal">Start equity</th>
                <th className="py-1 pr-3 font-normal">End equity</th>
                <th className="py-1 pr-3 font-normal">Day P&amp;L</th>
                <th className="py-1 font-normal">Trades</th>
              </tr>
            </thead>
            <tbody className="[font-variant-numeric:tabular-nums]">
              {days.map((d) => (
                <tr key={d.date} className="border-t border-[var(--chart-border)]">
                  <td className="py-1.5 pr-3">
                    <Link
                      href={`/history/${d.date}`}
                      className="font-medium text-[var(--text-primary)] hover:underline"
                    >
                      {formatDayHeading(d.date)}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{formatCurrency(d.startEquity)}</td>
                  <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{formatCurrency(d.endEquity)}</td>
                  <td
                    className="py-1.5 pr-3 font-medium"
                    style={{ color: d.pnl >= 0 ? "var(--status-good)" : "var(--status-critical)" }}
                  >
                    {formatSignedCurrency(d.pnl)}{" "}
                    <span className="font-normal text-[var(--text-muted)]">({formatPct(d.pnlPct)})</span>
                  </td>
                  <td className="py-1.5 text-[var(--text-secondary)]">{d.tradeCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="mt-8 text-xs text-[var(--text-muted)]">
        Paper trading only — Alpaca IEX feed, 5-minute bars. Day P&amp;L is that day&apos;s equity
        change (start-of-session to end-of-session), which can include an open position still
        marked-to-market at the end of the day.
      </footer>
    </main>
  );
}
