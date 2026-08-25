-- Paper Trading Arena — initial schema
-- Multi-bot-ready: bot_id on every table so more bots can join later.

create table if not exists bots (
  id text primary key,                    -- slug, e.g. 'day-trader-v1'
  name text not null,
  strategy_summary text,
  starting_cash numeric not null default 500,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Every order sent to Alpaca (entry, stop-loss leg, take-profit leg,
-- force-close). One row per broker order, not per round-trip trade.
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  bot_id text not null references bots(id),
  alpaca_order_id text unique,
  position_id uuid,                       -- fk added after positions exists
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  order_class text not null check (order_class in ('bracket', 'market')),
  leg text not null check (leg in ('entry', 'stop_loss', 'take_profit', 'force_close')),
  qty numeric not null,
  limit_price numeric,
  stop_price numeric,
  status text not null default 'new'
    check (status in ('new', 'filled', 'partially_filled', 'canceled', 'rejected', 'expired')),
  submitted_at timestamptz not null default now(),
  filled_at timestamptz,
  filled_avg_price numeric,
  mid_price_at_submit numeric,
  mid_price_at_fill numeric,
  raw jsonb,                              -- full Alpaca order payload, for debugging
  created_at timestamptz not null default now()
);

-- One round-trip position: entry to exit. This is what the dashboard's
-- "trade log" and "portfolio view" read from.
create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  bot_id text not null references bots(id),
  symbol text not null,
  qty numeric not null,
  entry_price numeric,
  entry_order_id uuid references orders(id),
  stop_order_id uuid references orders(id),
  take_profit_order_id uuid references orders(id),
  exit_order_id uuid references orders(id),
  exit_price numeric,
  status text not null default 'open' check (status in ('open', 'closed')),
  exit_reason text check (exit_reason in ('stop_loss', 'take_profit', 'force_close', 'manual')),
  realized_pnl numeric,
  reasoning text,                         -- why the entry signal fired (vwap/momentum/volume readout)
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

alter table orders
  add constraint orders_position_id_fkey foreign key (position_id) references positions(id);

-- Every 5-min scan cycle, every symbol, whether or not it traded — lets us
-- see *why* the bot did or didn't act, not just what it did.
create table if not exists scan_log (
  id uuid primary key default gen_random_uuid(),
  bot_id text not null references bots(id),
  ts timestamptz not null default now(),
  symbol text not null,
  price numeric,
  vwap numeric,
  momentum_pct numeric,                   -- % change over last 3 bars
  volume_ratio numeric,                   -- current bar volume / 20-bar avg
  signal_met boolean not null default false,
  skipped_reason text                     -- e.g. 'position_open', 'stopped_out_today', null if signal_met
);

-- End-of-day rollup for the leaderboard and equity charts.
create table if not exists daily_snapshots (
  id uuid primary key default gen_random_uuid(),
  bot_id text not null references bots(id),
  snapshot_date date not null,
  cash numeric not null,
  market_value numeric not null,
  equity numeric not null,
  daily_return numeric,
  cumulative_return numeric,
  created_at timestamptz not null default now(),
  unique (bot_id, snapshot_date)
);

-- Intraday equity ticks (populated each 5-min cycle) for live equity curve.
create table if not exists equity_ticks (
  id uuid primary key default gen_random_uuid(),
  bot_id text not null references bots(id),
  ts timestamptz not null default now(),
  equity numeric not null,
  cash numeric not null,
  market_value numeric not null
);

create index if not exists orders_bot_id_idx on orders(bot_id);
create index if not exists orders_symbol_idx on orders(symbol);
create index if not exists positions_bot_id_idx on positions(bot_id);
create index if not exists positions_status_idx on positions(status);
create index if not exists scan_log_bot_id_ts_idx on scan_log(bot_id, ts desc);
create index if not exists daily_snapshots_bot_id_idx on daily_snapshots(bot_id);
create index if not exists equity_ticks_bot_id_ts_idx on equity_ticks(bot_id, ts desc);

-- RLS: public dashboard reads via the publishable/anon key, all writes come
-- from server-side cron routes using the service role key (which bypasses
-- RLS entirely), so no insert/update/delete policies are defined here.
alter table bots enable row level security;
alter table orders enable row level security;
alter table positions enable row level security;
alter table scan_log enable row level security;
alter table daily_snapshots enable row level security;
alter table equity_ticks enable row level security;

create policy "public read" on bots for select using (true);
create policy "public read" on orders for select using (true);
create policy "public read" on positions for select using (true);
create policy "public read" on scan_log for select using (true);
create policy "public read" on daily_snapshots for select using (true);
create policy "public read" on equity_ticks for select using (true);

insert into bots (id, name, strategy_summary, starting_cash, is_active)
values (
  'day-trader-v1',
  'Day Trader',
  'Intraday momentum + volume: enters when price > session VWAP, up >=0.5% over last 3 five-min bars, and current bar volume >=1.5x the 20-bar average. Bracket order with 1% stop / 2% target. One position at a time, force-closed at 3:55pm ET.',
  500,
  true
)
on conflict (id) do nothing;
