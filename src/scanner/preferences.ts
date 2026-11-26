/** Local research organization only: never stores tokens, evidence or market history. */
export const PREFERENCE_KEY = "tickr.structure.preferences.v1";
export const PREFERENCE_FORMAT = "structure-preferences-v1";
export type Scope = "sample" | "private";
export type Watch = {
  security_id: string;
  symbol: string;
  name: string;
  isin: string;
};
export type Filters = {
  phase: string;
  sector: string;
  exchange: string;
  search: string;
  minRs: string;
  minVolume: string;
  minAdx: string;
  sort: string;
  direction: "asc" | "desc";
  columns: string[];
  watchOnly: boolean;
};
export type Preset = { name: string; filters: Filters };
export type Preferences = { watchlist: Watch[]; presets: Preset[] };
export type Library = { sample: Preferences; private: Preferences };
export const emptyLibrary = (): Library => ({
  sample: { watchlist: [], presets: [] },
  private: { watchlist: [], presets: [] },
});
export const defaultFilters = (): Filters => ({
  phase: "",
  sector: "",
  exchange: "",
  search: "",
  minRs: "",
  minVolume: "",
  minAdx: "",
  sort: "initial_signal_date",
  direction: "desc",
  columns: ["dates", "rs", "volume", "adx", "rsi"],
  watchOnly: false,
});
export const STAGES = [
  "Early Reversal",
  "Structure Developing",
  "Confirmed Bullish",
  "Strong Bullish",
  "Weakening",
  "Bearish",
];
const SORTS = [
  "initial_signal_date",
  "confirmation_date",
  "status_date",
  "rs63",
  "volume_ratio",
  "adx14",
  "symbol",
];
const COLUMNS = ["dates", "rs", "volume", "adx", "rsi"];
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Expected a preferences object.");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw Error("Unknown preference fields are not accepted.");
}
function string(value: unknown, max: number, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw Error("Invalid or oversized preference text.");
  return value;
}
export function validateFilters(value: unknown): Filters {
  const v = object(value);
  keys(v, Object.keys(defaultFilters()));
  const phase = string(v.phase, 40),
    sector = string(v.sector, 100),
    exchange = string(v.exchange, 3),
    search = string(v.search, 200);
  if (
    !["", ...STAGES].includes(phase) ||
    !["", "NSE", "BSE"].includes(exchange) ||
    !SORTS.includes(String(v.sort)) ||
    !["asc", "desc"].includes(String(v.direction)) ||
    typeof v.watchOnly !== "boolean"
  )
    throw Error("Invalid filter selection.");
  const numbers = ["minRs", "minVolume", "minAdx"].map((key) => {
    const text = string(v[key], 25);
    if (
      text !== "" &&
      (!text.trim() ||
        !Number.isFinite(Number(text)) ||
        Math.abs(Number(text)) > 1_000_000 ||
        (key !== "minRs" && Number(text) < 0) ||
        (key === "minAdx" && Number(text) > 100))
    )
      throw Error("Invalid numeric filter.");
    return text;
  });
  if (
    !Array.isArray(v.columns) ||
    v.columns.length > COLUMNS.length ||
    v.columns.some((column) => !COLUMNS.includes(column)) ||
    new Set(v.columns).size !== v.columns.length
  )
    throw Error("Invalid columns.");
  return {
    phase,
    sector,
    exchange,
    search,
    minRs: numbers[0],
    minVolume: numbers[1],
    minAdx: numbers[2],
    sort: v.sort as string,
    direction: v.direction as "asc" | "desc",
    columns: [...v.columns],
    watchOnly: v.watchOnly,
  };
}
export function validatePreferences(value: unknown): Preferences {
  const v = object(value);
  keys(v, ["watchlist", "presets"]);
  if (
    !Array.isArray(v.watchlist) ||
    v.watchlist.length > 500 ||
    !Array.isArray(v.presets) ||
    v.presets.length > 20
  )
    throw Error("Limit: 500 watched stocks and 20 presets per source.");
  const watchlist = v.watchlist.map((value) => {
    const w = object(value);
    keys(w, ["security_id", "symbol", "name", "isin"]);
    const security_id = string(w.security_id, 60, true),
      symbol = string(w.symbol, 40, true),
      name = string(w.name, 200, true),
      isin = string(w.isin, 12, true);
    if (
      !/^[A-Z0-9_-]{1,60}$/.test(security_id) ||
      !/^IN[A-Z0-9]{9}[0-9]$/.test(isin)
    )
      throw Error("Invalid watchlist identifier.");
    return { security_id, symbol, name, isin };
  });
  const presets = v.presets.map((value) => {
    const p = object(value);
    keys(p, ["name", "filters"]);
    return {
      name: string(p.name, 60, true).trim(),
      filters: validateFilters(p.filters),
    };
  });
  if (
    new Set(watchlist.map((w) => w.security_id)).size !== watchlist.length ||
    new Set(presets.map((p) => p.name.toLowerCase())).size !== presets.length
  )
    throw Error("Duplicate stocks or preset names.");
  return { watchlist, presets };
}
export function parseLibrary(raw: string): Library {
  if (raw.length > 1_000_000)
    throw Error("Saved preferences exceed the size limit.");
  const v = object(JSON.parse(raw));
  keys(v, ["format", "sample", "private"]);
  if (v.format !== PREFERENCE_FORMAT)
    throw Error("Unsupported preferences format.");
  return {
    sample: validatePreferences(v.sample),
    private: validatePreferences(v.private),
  };
}
export function importBackup(
  raw: string,
  scope: Scope,
  current: Preferences,
): Preferences {
  if (raw.length > 1_000_000) throw Error("Backup import limit is 1 MB.");
  const v = object(JSON.parse(raw));
  keys(v, ["format", "scope", "preferences"]);
  if (v.format !== PREFERENCE_FORMAT || v.scope !== scope)
    throw Error(
      "Backup belongs to a different source. Sample and private preferences stay separate.",
    );
  const incoming = validatePreferences(v.preferences);
  const watchlist = [...current.watchlist];
  for (const item of incoming.watchlist)
    if (!watchlist.some((w) => w.security_id === item.security_id))
      watchlist.push(item);
  const presets = [...current.presets];
  for (const item of incoming.presets) {
    const existing = presets.find(
      (p) => p.name.toLowerCase() === item.name.toLowerCase(),
    );
    if (
      existing &&
      JSON.stringify(existing.filters) !== JSON.stringify(item.filters)
    )
      throw Error(
        `Preset name conflict: ${item.name}. Rename or remove it before importing.`,
      );
    if (!existing) presets.push(item);
  }
  return validatePreferences({ watchlist, presets });
}
