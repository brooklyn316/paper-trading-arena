# Paper Trading Arena — Spec

Separate project from Bot Lab. Separate Supabase project, separate Vercel
deployment, separate GitHub repo. Do not touch Bot Lab.

## Stack

- Next.js 14 App Router, TypeScript, pnpm
- Supabase (new project) — trades, positions, bots, snapshots
- Vercel — hosting + cron
- Alpaca paper trading API — order execution + market data (IEX feed for v1)

## Bot #1: Day Trader ("day-trader-v1")

Fresh build, not ported from Bot Lab. Schema is multi-bot-ready (`bot_id` on
every table) so more bots can join the arena later, but this is the only bot
for now.

### Cadence

- Pulls 5-minute bars from Alpaca every 5 minutes during market hours
  (9:30 AM–4:00 PM ET, weekdays)
- Vercel cron fires every 5 min in that window

### Symbol universe (fixed watchlist, no scanner)

AAPL, MSFT, NVDA, TSLA, AMD, META, AMZN, GOOGL, SPY, QQQ

### Entry signal — all three must be true simultaneously

1. Price above session VWAP
2. Price up ≥ 0.5% over the last 3 five-minute bars (directional momentum)
3. Current bar volume ≥ 1.5× the 20-bar trailing average volume

No RSI, no other filters in v1. Bot scans the watchlist in order each cycle
and takes the **first** qualifying signal (one position at a time).

### Position sizing

- One open position at a time
- Max 40% of portfolio per trade ($200 max on a $500 start)
- No re-entry on a symbol after a stop-out that same day — move to the next
  qualifying symbol on the list

### Exits — exactly three, no trailing stop in v1

- Stop loss: 1% below entry
- Take profit: 2% above entry (2:1 reward/risk)
- Hard close: force-close whatever is open at 3:55 PM ET regardless of P&L

### Order mechanics

- Entry + stop + take-profit submitted together as a single **bracket order**
  the moment the signal fires. The stop and target are broker-enforced —
  the bot does not poll and react to price to protect the position. If a
  cron run is late or fails, the position is still protected.
- 3:55 PM ET force-close: dedicated cron hitting Alpaca's close-all-positions
  endpoint, independent of the regular 5-min signal cycle, so it fires even
  if the signal logic has a bug. TODO: confirm backup/retry approach.

### Starting cash

$500 simulated cash.

### Data feed

IEX (free) for v1. Paper trading — strategy logic is what's being tested,
not live execution fidelity. Upgrade to SIP if this goes toward real money
later.

### Fees

$0 commission simulated. Log executed price vs. mid-price at fill time so
effective spread cost is visible over time.

## Open items / TODO

- [ ] Finalize force-close cron design (task #10)
- [ ] Confirm Supabase project cost ($10/mo) with David before creating
- [ ] Decide GitHub repo hosting (new repo vs. workspace-only for now)
- [ ] Alpaca paper API keys (David generating via Alpaca dashboard)
