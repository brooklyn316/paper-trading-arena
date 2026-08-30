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
- Max 40% of portfolio per trade ($4,000 max on a $10,000 start)
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

$10,000 simulated cash (raised from the original $500 on 2026-08-29 — at
$500/$200-max, every symbol on the watchlist traded above the $200 cap, so
the bot could never afford a single whole share of anything and had zero
chance of ever trading). Authoritative value lives in Supabase's
`bots.starting_cash` column, not in code — `getCurrentTrackedCash()` reads
it from there. The `RISK.startingCash` constant in `config.ts` is
documentation only and must be kept in sync by hand.

### Data feed

IEX (free) for v1. Paper trading — strategy logic is what's being tested,
not live execution fidelity. Upgrade to SIP if this goes toward real money
later.

### Fees

$0 commission simulated. Log executed price vs. mid-price at fill time so
effective spread cost is visible over time.

## Infra

- Supabase project: `paper-trading-arena` (id `oxnhgofiyllhsawgypyd`), org
  `VoxLabs1` (free tier, $0/mo), region ap-southeast-2. Deliberately a
  separate Supabase org from Bot Lab's, not just a separate project —
  Bot Lab's org is on Pro, and a second project there would have billed
  ~$10/mo in compute on top of it. Schema applied via migrations `init` and
  `broaden_order_status_values`, RLS on with public-read policies on every
  table, no advisor warnings.
- GitHub repo: `brooklyn316/paper-trading-arena`, pushed from David's Mac.
- Vercel project: `paper-trading-arena`, git-linked, auto-deploys on push to
  `main`. Live at `paper-trading-arena-tawny.vercel.app`.
- Local dev copy lives at `~/Documents/Programmes/paper-trading-arena` on
  David's Mac, connected to this session via the desktop app's folder bridge.

## Open items / TODO

- [x] David to paste `SUPABASE_SERVICE_ROLE_KEY` from the Supabase dashboard
- [x] Alpaca paper API keys for day-trader-v1
- [x] GitHub repo created and pushed
- [x] Vercel project created and deployed, Alpaca connectivity verified live
- [x] day-trader-v1 cron route built: `src/lib/time.ts` (ET market-hours
      helpers), `src/lib/indicators.ts` (VWAP/momentum/volume-ratio),
      `src/lib/bots/day-trader-v1/config.ts` + `db.ts`,
      `src/app/api/cron/day-trader-v1/route.ts` (scan + bracket-order entry +
      reconciliation), `src/app/api/cron/force-close/route.ts` (independent
      3:55pm ET hard close), `vercel.json` cron schedule. Type-checks and
      builds clean.
- [x] Push to `main`, confirm Vercel picks up `vercel.json` and registers
      both cron jobs
- [x] Watch a live market-hours cron fire, confirm rows land correctly in
      `scan_log` and `equity_ticks` — confirmed 2026-08-25
- [x] Found + fixed: Next.js was silently caching every Alpaca fetch() call
      by URL, so the bot saw the same frozen prices/bars all day and could
      never clear `insufficient_bars`. Fixed by adding `cache: "no-store"`
      in `AlpacaClient`'s shared `request()`. Confirmed fixed 2026-08-26
      onward (prices vary intraday again).
- [x] Found + fixed: 3 real signals fired (Aug 26 AAPL, Aug 27 NVDA x2) but
      zero orders ever reached Alpaca (confirmed via order history — empty,
      account untouched at $100k). Root cause: at $500 starting cash / $200
      max position, every watchlist symbol traded above $200/share, so
      qty always floored to 0 and the entry silently no-opped before
      calling Alpaca. Fixed 2026-08-29 by raising starting cash to $10,000
      (`bots.starting_cash` in Supabase) and the max-position dollar cap to
      $4,000 (`RISK.maxPositionDollars` in config.ts) — same 40% ratio,
      scaled up so it isn't a silent bottleneck at current 2026 share prices.
- [ ] Watch for a live trade with the new $10k budget and confirm a real
      bracket order + position row get written correctly
- [ ] Remove the temporary `/api/debug/account` route once a real trade is
      verified live
- [x] Build the public dashboard UI: `src/lib/dashboard/queries.ts` (public/
      publishable-key reads — stat summary per bot, equity history, open
      position, recent closed trades, latest scan cycle), `src/components/
      EquityChart.tsx` (hand-rolled SVG line chart with hover crosshair,
      built to the dataviz skill's mark specs), `src/app/page.tsx` (stat
      tiles, equity curve, open position + latest scan panels, recent
      trades table, leaderboard — multi-bot-ready even with one bot).
      Also patched `createPublicClient` with `cache: "no-store"` — same
      Next.js fetch-caching bug as the Alpaca client, caught before it
      shipped this time. Verified visually (light + dark, via a temporary
      fixture-data preview page, deleted before commit) since this sandbox
      can't reach Supabase directly (same egress restriction as Alpaca).
      Type-checks and builds clean.
- [x] Found + fixed (2026-08-30, caught on the live site right after
      shipping the dashboard): stat tiles showed Equity $500 / Cash $10K /
      Total P&L -95% simultaneously — internally contradictory, and not a
      real loss. `summarizeBot()` was reading `currentEquity` straight off
      the latest `equity_ticks.equity` column, a value baked in by whatever
      `starting_cash` was true the last time the cron ran (Friday, at the
      old $500 base) — stale the moment `starting_cash` is changed by hand
      over a weekend with the market closed. Fixed by computing equity live
      as `currentCash + latest equity_ticks.market_value` instead of trusting
      the stored `equity` column.
