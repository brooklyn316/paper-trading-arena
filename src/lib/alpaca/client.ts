import {
  AlpacaAccount,
  AlpacaApiError,
  AlpacaBarsResponse,
  AlpacaLatestQuoteResponse,
  AlpacaOrder,
  AlpacaPosition,
  BracketOrderParams,
} from "./types";

export interface AlpacaClientConfig {
  keyId: string;
  secretKey: string;
  tradingBaseUrl: string; // e.g. https://paper-api.alpaca.markets
  dataBaseUrl: string; // e.g. https://data.alpaca.markets
  feed: "iex" | "sip";
}

/**
 * Thin wrapper around Alpaca's paper trading + market data REST APIs.
 * One instance per bot — each bot has its own key pair (its own paper
 * account), so there's no shared/global client.
 */
export class AlpacaClient {
  constructor(private config: AlpacaClientConfig) {}

  private authHeaders(): Record<string, string> {
    return {
      "APCA-API-KEY-ID": this.config.keyId,
      "APCA-API-SECRET-KEY": this.config.secretKey,
    };
  }

  private async request<T>(
    baseUrl: string,
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      // Next.js caches fetch() responses by default, keyed on URL. Several of
      // our calls (e.g. getBarsSince with a fixed session-start timestamp)
      // hit the exact same URL on every cron cycle, so without this every
      // call after the first would silently return the first cycle's stale
      // bars forever — route-level `dynamic = "force-dynamic"` does NOT
      // reliably prevent this for individual fetch calls.
      cache: "no-store",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text();
      }
      throw new AlpacaApiError(res.status, body);
    }

    // Some endpoints (e.g. DELETE /v2/positions) return 207/empty bodies.
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async getAccount(): Promise<AlpacaAccount> {
    return this.request<AlpacaAccount>(this.config.tradingBaseUrl, "/v2/account");
  }

  async getPositions(): Promise<AlpacaPosition[]> {
    return this.request<AlpacaPosition[]>(this.config.tradingBaseUrl, "/v2/positions");
  }

  async getPosition(symbol: string): Promise<AlpacaPosition | null> {
    try {
      return await this.request<AlpacaPosition>(
        this.config.tradingBaseUrl,
        `/v2/positions/${symbol}`
      );
    } catch (err) {
      if (err instanceof AlpacaApiError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * 5-minute bars for a set of symbols, most recent `limit` bars, during
   * regular market hours only.
   */
  async getRecentBars(
    symbols: string[],
    limit = 25
  ): Promise<AlpacaBarsResponse> {
    const params = new URLSearchParams({
      symbols: symbols.join(","),
      timeframe: "5Min",
      limit: String(limit),
      feed: this.config.feed,
      adjustment: "raw",
      sort: "asc",
    });
    return this.request<AlpacaBarsResponse>(
      this.config.dataBaseUrl,
      `/v2/stocks/bars?${params.toString()}`
    );
  }

  /**
   * All 5-minute bars for a set of symbols from `startISO` up to now. Used
   * for session VWAP, which needs every bar since the market open (9:30am
   * ET) rather than a fixed recent window — the correct bar count varies
   * with the time of day. Paginates via `next_page_token` since Alpaca caps
   * each response page.
   */
  async getBarsSince(
    symbols: string[],
    startISO: string
  ): Promise<AlpacaBarsResponse> {
    const bars: Record<string, AlpacaBarsResponse["bars"][string]> = {};
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        symbols: symbols.join(","),
        timeframe: "5Min",
        start: startISO,
        feed: this.config.feed,
        adjustment: "raw",
        sort: "asc",
        limit: "1000",
      });
      if (pageToken) params.set("page_token", pageToken);

      const page = await this.request<AlpacaBarsResponse>(
        this.config.dataBaseUrl,
        `/v2/stocks/bars?${params.toString()}`
      );

      for (const [symbol, symbolBars] of Object.entries(page.bars)) {
        bars[symbol] = [...(bars[symbol] ?? []), ...symbolBars];
      }
      pageToken = page.next_page_token ?? undefined;
    } while (pageToken);

    return { bars, next_page_token: null };
  }

  async getLatestQuote(symbol: string): Promise<AlpacaLatestQuoteResponse> {
    const params = new URLSearchParams({ feed: this.config.feed });
    return this.request<AlpacaLatestQuoteResponse>(
      this.config.dataBaseUrl,
      `/v2/stocks/${symbol}/quotes/latest?${params.toString()}`
    );
  }

  /**
   * Entry + stop-loss + take-profit submitted as one bracket order. The
   * broker enforces the stop/target legs — we do not poll and react.
   */
  async submitBracketOrder(params: BracketOrderParams): Promise<AlpacaOrder> {
    return this.request<AlpacaOrder>(this.config.tradingBaseUrl, "/v2/orders", {
      method: "POST",
      body: JSON.stringify({
        symbol: params.symbol,
        qty: params.qty,
        side: params.side,
        type: "market",
        time_in_force: "day",
        order_class: "bracket",
        client_order_id: params.clientOrderId,
        take_profit: { limit_price: params.takeProfitPrice.toFixed(2) },
        stop_loss: { stop_price: params.stopLossPrice.toFixed(2) },
      }),
    });
  }

  async getOrder(orderId: string): Promise<AlpacaOrder> {
    return this.request<AlpacaOrder>(this.config.tradingBaseUrl, `/v2/orders/${orderId}`);
  }

  /**
   * Recent orders, optionally filtered by symbol. Used during reconciliation
   * to look up bracket leg fills, and to self-heal if a position exists at
   * Alpaca that our DB doesn't know about (e.g. the cron crashed right after
   * submitting an order but before recording it).
   */
  async listOrders(
    params: { status?: "open" | "closed" | "all"; symbols?: string[]; limit?: number } = {}
  ): Promise<AlpacaOrder[]> {
    const qp = new URLSearchParams({
      status: params.status ?? "all",
      limit: String(params.limit ?? 50),
      direction: "desc",
      nested: "true", // include bracket legs inline on the parent order
    });
    if (params.symbols?.length) qp.set("symbols", params.symbols.join(","));
    return this.request<AlpacaOrder[]>(
      this.config.tradingBaseUrl,
      `/v2/orders?${qp.toString()}`
    );
  }

  /** Cancels every open order, then market-closes every open position. Used
   * for the 3:55pm ET force-close — independent of the bracket orders, so it
   * still works even if a bracket leg somehow didn't cover the position. */
  async closeAllPositions(): Promise<unknown> {
    await this.request(this.config.tradingBaseUrl, "/v2/orders", { method: "DELETE" });
    return this.request(this.config.tradingBaseUrl, "/v2/positions?cancel_orders=true", {
      method: "DELETE",
    });
  }
}

export function createAlpacaClientFromEnv(botEnvPrefix: string): AlpacaClient {
  const keyId = process.env[`ALPACA_${botEnvPrefix}_KEY_ID`];
  const secretKey = process.env[`ALPACA_${botEnvPrefix}_SECRET_KEY`];
  const tradingBaseUrl = process.env.ALPACA_PAPER_BASE_URL ?? "https://paper-api.alpaca.markets";
  const dataBaseUrl = process.env.ALPACA_DATA_BASE_URL ?? "https://data.alpaca.markets";
  const feed = (process.env.ALPACA_DATA_FEED as "iex" | "sip") ?? "iex";

  if (!keyId || !secretKey) {
    throw new Error(
      `Missing ALPACA_${botEnvPrefix}_KEY_ID or ALPACA_${botEnvPrefix}_SECRET_KEY env vars`
    );
  }

  return new AlpacaClient({ keyId, secretKey, tradingBaseUrl, dataBaseUrl, feed });
}
