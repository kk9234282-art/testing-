export type Nullable = number | null;
export interface Parameters {
  pivot_left: number;
  pivot_right: number;
  swing_atr: number;
  break_atr: number;
  retest_bars: number;
}
export interface Fundamental {
  period_end: string;
  known_on: string;
  source: string;
  values: Record<string, Nullable>;
}
export interface StockRow {
  security_id: string;
  listing_id: string;
  symbol: string;
  name: string;
  isin: string;
  sector: string;
  exchange: string;
  exchanges: string[];
  status: string | null;
  initial_signal_date: string | null;
  confirmation_date: string | null;
  status_date: string | null;
  support: Nullable;
  resistance: Nullable;
  close: Nullable;
  ema20: Nullable;
  sma50: Nullable;
  sma200: Nullable;
  rsi14: Nullable;
  macd: Nullable;
  macd_signal: Nullable;
  macd_hist: Nullable;
  adx14: Nullable;
  rs63: Nullable;
  volume_ratio: Nullable;
  delivery_pct: Nullable;
  history_sessions: number;
  data_quality: string;
  fundamentals: Fundamental | null;
}
export interface IndexReport {
  index_id: string;
  name: string;
  role: string;
  score: Nullable;
  regime: string;
  members: number;
  expected_members: number;
  coverage: number;
  advances: number;
  declines: number;
  unchanged: number;
  above50_pct: Nullable;
  above200_pct: Nullable;
  new_highs: Nullable;
  new_lows: Nullable;
  high_low_coverage: number;
  close: Nullable;
}
export interface Scan {
  as_of: string;
  manifest: {
    name: string;
    kind: "sample" | "licensed";
    source: string;
    license_reference: string;
    notes: string;
  };
  parameters: Parameters;
  rows: StockRow[];
  counts: Record<string, number>;
  regime: {
    indices: IndexReport[];
    advance_decline_line: { date: string; value: number }[];
    advance_decline_lines: Record<string, { date: string; value: number }[]>;
    missing_indices: string[];
  };
  sectors: {
    sector: string;
    companies: number;
    classified: number;
    eligible: number;
    bullish: number;
    bullish_pct: Nullable;
    early: number;
  }[];
  coverage: {
    active_equities: number;
    complete: number;
    excluded_instruments: number;
  };
}
export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: Nullable;
  ema20: Nullable;
  sma50: Nullable;
  sma200: Nullable;
  relative_line: Nullable;
  rs63: Nullable;
}
export interface StructureEvent {
  type: string;
  date: string;
  level?: number;
  status?: string | null;
  episode: string | null;
  reason: string;
}
export interface Pivot {
  id: string;
  kind: string;
  label: string;
  price: number;
  pivot_date: string;
  confirmed_on: string;
}
export interface Detail {
  security: {
    security_id: string;
    name: string;
    symbol: string;
    exchange: string;
    isin: string;
    sector: string;
  };
  as_of: string;
  price_basis: string;
  series: Candle[];
  pivots: Pivot[];
  events: StructureEvent[];
  timeline: {
    date: string;
    status: string | null;
    initial_signal_date: string | null;
    confirmation_date: string | null;
    status_date: string | null;
    support: Nullable;
    resistance: Nullable;
  }[];
  fundamentals: Fundamental | null;
}
export interface Cohort {
  horizon: number;
  regime: string;
  signals: number;
  completed: number;
  censored: number;
  mean_return_pct: Nullable;
  win_rate_pct: Nullable;
  worst_trade_drawdown_pct: Nullable;
  failed_breakout_pct: Nullable;
}
export interface Backtest {
  as_of: string;
  signal: string;
  fee_bps_per_side: number;
  slippage_bps_per_side: number;
  summary: Cohort[];
  by_regime: Cohort[];
  method: string;
  trades: {
    security_id: string;
    signal_date: string;
    entry_date: string | null;
    horizon: number;
    regime: string;
    return_pct: Nullable;
    drawdown_pct: Nullable;
    failed_breakout: boolean;
    reason: string | null;
  }[];
}
export interface Demo {
  scan: Scan;
  backtest: Backtest;
  stocks: Record<string, Detail>;
}
export interface Dataset {
  id: string;
  created_at?: string;
  manifest: {
    name: string;
    latest_complete_session: string;
    corporate_actions_complete?: boolean;
    universe_history_complete?: boolean;
    kind: string;
    source: string;
  };
}

export interface MarketStatus {
  storage_bytes: number;
  paid_fallback: false;
  scheduler: string;
  feeds: {
    feed_id: string;
    dataset_id: string | null;
    source: string | null;
    last_success_at: string | null;
    latest_complete_session: string | null;
    stale: boolean;
    last_error: string | null;
    usage_today: { requests: number; bytes: number; paused: boolean };
    permission: { daily_request_limit: number; daily_download_bytes: number };
  }[];
}
