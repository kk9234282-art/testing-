# Indian Bullish Structure Scanner — EOD MVP

The existing market dashboard stays at `/`. The separate React/TypeScript application is `/scanner.html`, linked as **Structure scanner**. Its CSS, state, Python calculations, dataset storage and API namespace are separate from the previous features. No migration to Next.js or replacement of the existing React application is required.

## What runs now

- A deterministic **synthetic** research dataset demonstrates discovery, six classifications, sortable/filterable stocks, sector rankings, index regimes, annotated stock charts and 20/40/60-session cohorts. These results are computed by the actual Python engine, not hardcoded status labels or hypothetical screenshots.
- The demo includes 16 fictional economic equities, an NSE/BSE dual listing, a cash delisting, a split and an excluded ETF. Fifteen equities remain active on its final session. Synthetic weekday calendars and index constituents are not actual exchange calendars or index membership.
- Five required broad-index roles and a sector-index role are illustrated. Missing real benchmark data is never replaced with a different index.
- A private FastAPI/PostgreSQL service accepts validated historical JSON imports and runs scans/backtests in a single EOD job worker. The website's same-origin bridge forwards the user's bearer token; it never injects an owner credential for anonymous visitors.
- There is **no licensed provider connected**, no live signal feed, no intraday polling and no automatic trading. Real-market results require licensed source files and deployment of the private service.

## Open or develop the website

```sh
npm ci
npm run build
npm start
```

Open `/scanner.html` on the resulting server. `npm run dev` also serves that page. The precomputed public demo works on Vercel without Python or a database. It is fetched only by the scanner page, not by the existing market dashboard. Stock pages have sample links such as `/scanner.html#/stock/DEMO_01`.

## Start the private stack

1. Copy `scanner_service/.env.example` to the **gitignored** `.env.scanner` file.
2. Replace both password/token placeholders with different random values. Generate a token with `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`. Environment-configured service tokens below 24 characters and the example placeholders are refused.
3. Start PostgreSQL 16 and FastAPI:

```sh
mkdir -p .scanner-private/imports
docker compose --env-file .env.scanner -f compose.scanner.yml up -d --build
```

4. Run the existing web application with its local bridge:

```sh
SCANNER_SERVICE_URL=http://127.0.0.1:3002 npm run dev
```

5. In `/scanner.html`, choose **Private imported history**, enter the service token and select **Connect**. The token stays in browser memory; it is not saved in local storage or URLs. Under **Data & methodology**, import a bundle, choose its finalized session and run the EOD scan. Backtesting has a separate explicit job action.

The PostgreSQL volume is persistent. Database ports are not published; the API is bound to loopback in this Compose setup. Use **one API worker**. On service restart, interrupted queued/running jobs become failed with a resubmission message rather than pretending to be running forever. Jobs are persisted and reproducible, not a distributed exactly-once queue. Back up PostgreSQL before discarding its volume.

For production, host this service and PostgreSQL on your own persistent backend and set the Vercel **server** environment variable `SCANNER_SERVICE_URL` to its HTTPS origin. Never put the service token in a `VITE_` variable. The existing `connect-src 'self'` policy works because the browser uses `/api/structure/*`. Vercel serves the UI and bridge, not the long-running Python worker. Private stock links include their immutable scan run; reopening one requires re-entering the token and connecting.

Cloud builds behind a custom CA can pass it as an optional BuildKit secret, without storing it in an image:

```sh
docker build --secret id=proxy_ca,src=/path/to/trusted-ca-bundle.pem -t structure-service scanner_service
```

## Import contract

Download `/structure-import-example.json` and `/structure-import-schema.json` from the scanner's methodology tab. The example is synthetic; do not relabel it as licensed market data.

The JSON bundle contains:

| Collection | Required meaning |
| --- | --- |
| `manifest` | Name/source/license reference, `kind` (`sample` or user-attested `licensed`), `currency: INR`, explicit `ohlcv_basis: raw`, final complete session and source completeness attestations. |
| `sessions` | Unique ascending actual exchange session dates, including special sessions where applicable. Do not manufacture weekdays to fill a real import. |
| `securities` | Permanent economic `security_id`, dated `listing_id`, checksum-valid ISIN, exchange, ticker, name, sector, instrument type, `valid_from`, exclusive `valid_to`, and actual `known_on`. |
| `bars` | Raw/unadjusted INR daily OHLC, raw share volume, `is_final: true`, optional delivery percentage and an explicit reliability flag. |
| `actions` | Verified split/bonus/dividend factors, effective/known dates and source reference. Price factors apply to earlier OHLC; volume factors apply to earlier volume. |
| `benchmarks` / `index_bars` | Price-index IDs, roles, expected membership counts and finalized closing levels. Nifty 500 must be `NIFTY_500`; TRI series are not interchangeable with price indices. |
| `memberships` | Permanent security IDs with effective intervals and actual publication/knowledge dates, for every historical index composition used. |
| `fundamentals` | Period end, actual publication/knowledge date, source and finite numeric metrics. The newest available period is selected, then the latest known revision of that period. |
| `terminals` | Optional verified full cash settlement for a delisted entry listing; one terminal settlement per listing. Missing settlements are not guessed. |

All master/membership intervals are `[valid_from, valid_to)`. Overlapping versions, conflicting simultaneous identifiers, duplicate bars, orphan records, invalid OHLC, non-final bars and unverified/inconsistent factors are rejected. Master/membership changes must be known by their effective date; late retrospective corrections need a separately versioned input dataset rather than being silently treated as originally known. Fundamentals are not available before their publication date. Dates, not the provider's latest current directory, select the universe and sector.

NSE/BSE equities are admitted only with `instrument_type: EQUITY`; ETFs, warrants, indices and other instruments stay out of scans. A permanent ID groups explicitly identified dual listings, preferring the active NSE listing at each historical date. Name similarity is not used to merge companies. Delisted securities remain in the imported master and backtest universe.

Splits/bonuses require reciprocal price and volume factors. Cash dividends require a provider-supplied positive price adjustment factor below one, cash per share and unchanged volume. Same-session cash amounts must use the **post-split/bonus per-share basis**. Unsupported mergers, share exchanges, rights reinvestment and multi-installment terminal settlements are not inferred by the MVP; represent supported verified economic settlements or leave the affected outcome censored. Already-adjusted OHLCV must not be imported with action factors again.

The app cannot independently certify that an uploaded universe includes every delisting or that a vendor history is complete. Attestations are required before backtesting, and coverage/censor counts remain visible. An owner must audit the licensed source and its corrections. `expected_members` is constant per imported index definition; count mismatches make that regime score unavailable instead of assuming a current membership list.

Browser imports are limited to **3 MB**, below the serverless bridge limit. For a complete licensed universe, place the file in `.scanner-private/imports` and import directly into the service:

```sh
docker compose --env-file .env.scanner -f compose.scanner.yml exec -T scanner \
  python -m scanner_service.cli import /imports/history.json
```

The printed SHA-256 is the immutable dataset ID. Identical payloads are idempotent; changed inputs create a new version. Private bundles are stored in PostgreSQL JSONB with their complete identifier/action/membership histories, not copied into `public/`. The Python CLI has no 3 MB browser limit. This first MVP loads a bundle into memory: full-exchange, multi-year throughput has not been benchmarked and should be capacity-tested before production use. Partitioned market-data storage and resumable bulk adapters are future work, not claims of this version.

## Daily engine definitions

- ATR 14 uses true range, an initial 14-value SMA and Wilder smoothing. Default swings use 3 bars left, **3 completed bars right**, a unique extreme (ties excluded) and at least 1 ATR separation from the latest opposite pivot. Same-kind pivots less than 0.25 ATR apart are ignored; accepted pivots are never removed retrospectively.
- HH/LH compare confirmed highs; HL/LL compare confirmed lows. A pivot's event becomes usable on `pivot_date + right` **exchange observations**, not on its center date. Stock charts plot the confirmation date, and the audit table retains both dates.
- A daily close beyond a confirmed high plus a default 0.1 ATR buffer creates bullish CHoCH from bearish/neutral/weakening structure. It starts **Early Reversal**, not a recommendation.
- A later confirmed HL after that initial signal creates **Structure Developing**. A subsequent close-confirmed BOS after the HL creates **Confirmed Bullish** and records a separate confirmation date.
- **Strong Bullish** requires that already-confirmed structure plus EMA20 > SMA50 > SMA200, positive 63-session excess price return versus Nifty 500, volume at least 1.2× the preceding 20-session average, and ADX14 ≥ 20. Indicators never independently create a bullish episode.
- A close back below a breakout by 0.25 ATR within the default 10-session window is a failed breakout. A later test within 0.25 ATR that closes above the level is a retest; neither is awarded on the breakout bar itself.
- Loss of protected support or a failed breakout produces **Weakening**; confirmed LH/LL bearish structure produces **Bearish**. Current status, initial date, first confirmation date and latest state-change date are retained separately. Neutral/no-transition and incomplete-history cases are labelled explicitly rather than fabricated as bearish.
- EMA uses first-close recursive initialization (`adjust=False`) and exposes its warmup. SMA requires the full period. RSI14 uses Wilder gains/losses (flat=50, gain-only=100, loss-only=0). MACD is EMA12−EMA26 with EMA9 signal. ADX14 uses Wilder directional movement; undefined warmups stay unavailable. Volume ratio excludes today's bar from its 20-session denominator. Delivery is displayed only if explicitly verified.

Structure OHLC/MA calculations use provider factors effective through the as-of date, including dividend factors to avoid mechanical ex-dividend gaps being mistaken for structure. RS, breadth and new highs/lows use **split/bonus-adjusted price-only** series, consistently compared with price indices; cash yield is not silently compared with a non-TRI benchmark. RS63 is the stock's 63-session price return minus the Nifty 500 price return in percentage points. The relative line is their price ratio, normalized to 100 at the first common observation.

Later corporate actions can rescale earlier displayed price levels. The engine's historical decision rules are scale-invariant (ATR buffers, relative returns and price/MA relationships), and tests verify that applying a later uniform price/share rebase does not change previously known signal dates. Every snapshot applies only factors effective by its as-of date; raw holding returns are accounted separately. Missing stock sessions withhold current structural annotations and exclude that stock from eligible breadth instead of compressing a missing day into a shorter lookback.

## Regime and sector context

Each imported broad or sector index exposes advances/declines, percentage above price SMA50/SMA200, strict 252-session new highs/lows and an A/D line from the dataset's beginning. Membership and preferred listing are selected at each historical session; there is no current-constituent backfill or stale-price forward fill. A missing benchmark session cannot shorten a 200-session SMA into 200 available observations.

A score requires the index's complete most-recent 200 sessions, exact expected membership count and at least 80% constituent SMA200 coverage. Components: index above SMA200 (25), index above EMA20 (15), constituent share above SMA50 (30), share above SMA200 (20), and smoothed high/low ratio `(new_highs+1)/(new_highs+new_lows+2)` (10). The final high/low component is omitted until eligible history exists and available weights are normalized. Scores ≥65 are Risk-on, 40–65 Mixed, below 40 Defensive; unavailable evidence stays unavailable. These weights are explicit research heuristics, not a proven forecast model.

Sector rankings use confirmed/strong share among complete-history eligible equities. Eligible neutral stocks remain in the denominator; the classified and eligible counts are both shown. Small samples or incomplete licensed coverage still need review.

## Backtesting definitions and limits

Each initial/confirmed episode produces at most one cohort entry on its selected listing. The signal is known at its session close; entry uses the **next calendar session's reported open**, requiring positive reported daily volume. A gap/no-trade open is censored, not filled at the same close or silently moved to a later favorable date. Positive daily volume is only a basic execution assumption, not proof of a real opening fill.

- Horizons are 20/40/60 imported exchange sessions, including the entry session, ending at that horizon's close. They are unconditional hypothetical holdings, not a stop-loss or portfolio strategy.
- Per-side fees and slippage are explicit (defaults 10 and 5 bps). A zero-volume exit is censored. Mean returns and win rate use only completed outcomes, with complete/censored denominators shown separately.
- Split/bonus share counts and gross cash-dividend receivables preserve economic value. There is no automatic dividend reinvestment or tax model. A position opened on an ex-date does **not** receive the prior holder's entitlement.
- Verified cash delisting settlement stays as cash for the remaining horizon. Missing holding-period bars, absent settlement or unmatured outcomes are censored. The model does not automatically transfer a holding between exchange listings or infer merger consideration.
- Drawdown is the worst close-marked peak-to-trough drawdown of an **individual cohort holding**, including transaction friction, not a compounded portfolio maximum drawdown. Overlapping trades are not presented as a self-financing portfolio.
- Failed-breakout frequency refers to a failure in the same structural episode during the holding window. Regime grouping uses information at the **signal date**, not the future exit regime.

Survivorship controls operate on the supplied historical master: inactive securities are evaluated and dual listings are not double counted. They cannot repair an incomplete vendor universe. Censored outcomes can themselves be selective; do not interpret completed-only means as unbiased estimates without inspecting source coverage and the censor audit. No empirical profitability or predictive claim is made from the synthetic demo.

## Reproduce and test

```sh
python3 -m venv .venv-scanner
.venv-scanner/bin/pip install -r scanner_service/requirements.lock
.venv-scanner/bin/python -m unittest discover -s scanner_service/tests -v
npm run typecheck:scanner
npm run build
npm test
npm run test:browser
SCANNER_PYTHON=.venv-scanner/bin/python npm run test:scanner:browser
```

Set `SCANNER_TEST_DATABASE_URL` to your own **test** PostgreSQL URL for SQL/API/browser tests; otherwise the tests use disposable SQLite development stores. PostgreSQL integration was exercised against PostgreSQL 16, not just the fallback. Tests use clearly identifiable synthetic credentials and data, never a licensed source or production DB. Regenerate the public synthetic assets only with:

```sh
.venv-scanner/bin/python -m scanner_service.demo
```

This writes only generated demo/example/schema files. The private import CLI never exports a user's data to public assets. Dataset checksums, engine source fingerprints, dependency versions and run parameters are retained for audit. The dependency lock is used by the Docker image; direct runtime requirements are also listed for maintenance.

API surface (all except health require `Authorization: Bearer …`):

| Method/path under `/api/structure` | Purpose |
| --- | --- |
| `GET /health` | Configuration readiness; never returns a token or database URL. |
| `GET /datasets` | Private dataset versions and manifests. |
| `POST /import` | Validate/store a ≤3 MB bundle. |
| `POST /runs/scan` or `/runs/backtest` | Queue an explicit reproducible EOD job; returns 202 and its run ID. |
| `GET /runs/{id}` | Job state, parameters, provenance and completed result/error. |
| `GET /runs/{id}/stocks/{security_id}` | Stock history for a completed scan and its as-of dataset. |

The service uses one in-process worker and a small queue. Production authentication is a single-owner bearer token, not a multi-tenant account system. Advanced provider adapters, automatic ingestion, larger partitioned datasets, distributed scheduling, benchmark constituent-count versioning and complex non-cash corporate actions are intentionally outside this import-ready MVP.

## Rollback

The stable website before this section is tagged **`before-structure-scanner-2026-11-25`** (`140e20c`). Revert the single commit **`Add isolated end-of-day structure scanner MVP`**, or redeploy that tag. The existing market page does not read scanner datasets or require the Python service. Removing the frontend does not erase private PostgreSQL records or volumes; preserve those independently if needed.

## Optional private free-source file ingestion

The existing bundle engine can now be fed by validated private CSV/ZIP imports, with incremental deduplication, immutable history, update/error records and request/storage budgets. This does not establish provider permission or real-market validation: [current evidence and blockers](docs/FREE_MARKET_DATA_REPORT.md). Follow the [setup guide](docs/FREE_MARKET_DATA_SETUP.md); synthetic data must never be relabelled as actual market data. No paid service has been provisioned.

## Local watchlists and filter presets

Open **Research workspace** on `/scanner.html`. Use **Watch** in Discovery or on a stock page, then enable **Watchlist only** in Discovery to narrow the current scan. Saved stocks missing from the current scan remain in the workspace with “Not in current scan”; they do not receive stale prices or invented signals. Identity is the dataset's stable `security_id`, not a ticker alone. Alias deduplication therefore depends on reviewed source identity mappings.

Set the Discovery filters, open Research workspace, give the current configuration a name and save it. Choose the preset and press **Apply saved filters** to restore stage, sector, exchange, search, RS, volume, ADX, sorting, visible columns and watchlist-only mode. Dates, engine parameters and credentials are excluded. A sector missing from a later scan stays visibly selected and can return no matches rather than silently broadening the filter. Use a new name or remove an existing preset to replace it.

Preferences use the separate browser key `tickr.structure.preferences.v1`. Synthetic/imported-sample and private-real workspaces are partitioned; the main dashboard's `tickr-watch` key is untouched. No stock-history download, new account, service charge or API request is needed. The browser profile can read these preferences; they are not encrypted or synchronized across devices. Use one editing tab at a time. Storage failures retain changes in memory with a warning; invalid stored preferences are not overwritten on startup.

**Export research backup** downloads only the current source's stock identity snapshots and presets. **Import research backup** accepts up to 1 MB, merges stocks by stable ID, deduplicates exact presets, and rejects cross-source files, conflicting preset names, unknown fields, invalid values or capacity overflows. Limits are 500 watched stocks and 20 presets per source. Keep a private export before clearing browser data. Action-review evidence, owner tokens and market-data history are never included. These files are editable preferences, not trusted research inputs or proof of source identity.

Validation: `npm test` includes the preference-model boundary/merge tests. After `npm run build`, `npm run test:scanner:workspace` tests persistence, saved-filter restoration, backups, source/main-dashboard isolation, missing stocks, blocked/corrupted storage and mobile layout using synthetic fixtures. The corporate-action review browser audit remains separate (`npm run test:scanner:review`). None of this changes the strict signal or backtest gates.

## Hosted batch execution

Hosted-only deployment preparation now includes an external queue/worker mode and manual job-status loading. This separates batch execution from short-lived API instances; it does not provision hosted PostgreSQL, a scheduler or permitted real data. See [hosted scanner requirements and recovery](docs/HOSTED_SCANNER.md) before selecting a host. The persistent local service remains in embedded mode by default.

## Explicit Vercel scanner routes

The website's Vite/file-based deployment needs explicit nested function entries for `market-data/status`, `runs/{kind-or-id}` and `runs/{id}/stocks/{security_id}`. The original `[...path].js` endpoint worked for one-segment URLs such as datasets but returned Vercel's plain-text 404 for those deeper paths. The three explicit functions re-export the same fixed-path, authenticated bridge, preserving the legacy endpoint and all existing website APIs. The Python backend, database and source-verification gates are unchanged.

The scanner now handles non-JSON platform errors without displaying raw HTML or a JSON-parser exception. A failed request stops its “Queuing” message, never retries automatically, and advises checking an already returned job ID before resubmission. Regression tests cover each explicit handler's method/path/token forwarding, rejected paths, plain-text/HTML errors and browser recovery after a routing failure. Local Express wildcard routing alone does not establish Vercel file-based route coverage; deployed route checks are separate.
