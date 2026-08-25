export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  cash: string;
  portfolio_value: string;
  buying_power: string;
  equity: string;
  last_equity: string;
  pattern_day_trader: boolean;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  qty: string;
  side: "long" | "short";
  avg_entry_price: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  current_price: string;
}

export interface AlpacaBar {
  t: string; // ISO timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw: number; // volume-weighted average price for the bar
  n: number; // trade count
}

export interface AlpacaBarsResponse {
  bars: Record<string, AlpacaBar[]>; // keyed by symbol for multi-symbol requests
  next_page_token: string | null;
}

export interface AlpacaQuote {
  t: string;
  ap: number; // ask price
  as: number; // ask size
  bp: number; // bid price
  bs: number; // bid size
}

export interface AlpacaLatestQuoteResponse {
  symbol: string;
  quote: AlpacaQuote;
}

export type AlpacaOrderSide = "buy" | "sell";

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  qty: string | null;
  side: AlpacaOrderSide;
  type: string; // 'market' | 'limit' | 'stop' | 'stop_limit' — bracket legs use 'stop' (stop-loss) and 'limit' (take-profit)
  order_class: string;
  status: string;
  filled_qty: string;
  filled_avg_price: string | null;
  limit_price?: string | null;
  stop_price?: string | null;
  submitted_at: string;
  filled_at: string | null;
  legs: AlpacaOrder[] | null;
}

export interface BracketOrderParams {
  symbol: string;
  qty: number;
  side: AlpacaOrderSide;
  stopLossPrice: number;
  takeProfitPrice: number;
  clientOrderId?: string;
}

export class AlpacaApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`Alpaca API error (${status}): ${JSON.stringify(body)}`);
    this.name = "AlpacaApiError";
    this.status = status;
    this.body = body;
  }
}
