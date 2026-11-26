# Free market-data integration: evidence and outstanding gates

Audit date: 26 November 2026 (India). Budget: ₹0/month; no paid services, accounts, upgrades or fallback providers have been enabled.

**This integration is not yet validated with real-market data.** No real source has been selected, no actual NSE/BSE history has been imported in this task, and no public-deployment verification has succeeded. The deployed demo must remain labelled synthetic. Contract fixtures and local PostgreSQL/browser tests are software verification, not evidence of actual prices, free provider eligibility or historical profitability.

## Existing project audit

The separate React scanner, FastAPI job API, PostgreSQL immutable input datasets and causal market-structure/backtest modules already exist. The engine uses confirmed ATR-filtered pivots, closing-price breaks, next-session entries and source completeness gates. A private same-origin bridge protects user-supplied tokens. These components are reused.

Missing operational pieces were CSV/ZIP conversion, incremental merge, artifact identity, import failures/update status, request budgets and a repeatable historical audit. Those have been added without modifying `structure.py`, `indicators.py`, `research.py`, `backtest.py` or `schema.py`. Extra breadth diagnostics are separate and do not change regime weights or signal rules. A database storage guard also covers original JSON imports and research result writes.

Existing storage retains complete immutable snapshots for reproducibility. This is appropriate for a small personal validation universe; it is **not** an efficient all-exchange multiyear warehouse. New daily candles are merged without re-downloading old source files, but new dataset versions still retain full input payloads. Operations stop at the configured storage budget. A larger warehouse would need a separately justified storage migration, which has not been performed.

## Provider comparison and evidence

| Source | Evidence obtained in this task | Coverage / fields established | Free quota and rights status | Decision |
| --- | --- | --- | --- | --- |
| TejHQ | Requests to https://www.tejhq.com/ failed at the cloud proxy (CONNECT 403); official terms/docs not obtained | NSE/BSE, historical length, OHLCV, volume, delivery, actions and adjustments **unverified** | Free API availability, daily limits, personal use and redistribution **unverified** | Priority for research after network access is applied; not selected or called |
| ICICI Breeze | Official [SDK README](https://github.com/Idirect-Tech/Breeze-Python-SDK/blob/main/README.md) successfully fetched from the provider's GitHub repository | README advertises ten years of history including one-second OHLCV and documents historical-data methods/NSE equity examples. This is a documentation claim, not a successful account request. General BSE code references do **not** establish BSE cash historical coverage. Delivery, raw/adjusted conventions, complete action history and all required index histories remain unverified | Current account eligibility, subscription/account charges, daily market-data quota and data-use rights **unverified**. Order-routing rate limits are not market-data quotas. SDK code licensing is not a market-data redistribution licence | No account/key supplied; no broker integration or order API added |
| Official NSE/BSE daily files | Official sites/archives blocked by current domain allowlist | Adapters support known legacy and UDiFF daily equity column contracts. Current downloadable archive formats, available dates, raw-price semantics and access conditions have **not** been verified against actual files in this task. Delivery is optional and never fabricated | Public accessibility is not permission. Permitted automation, request allowance, archive access, personal use and redistribution require verification | Private local-file import is ready; network downloader disabled unless permission and zero-cost budgets are explicitly recorded |
| Nifty Indices official history | https://www.niftyindices.com/ blocked | Current index-file availability and histories for all five requested broad indices/sector indices unverified; PIT constituents not obtained | Personal use, automated download and redistribution terms unverified | Manual index CSV conversion ready; no inferred constituent history |
| Yahoo Finance | Existing project has a Yahoo chart integration; this does not grant a licence for this scanner | No source-qualified actual historical import performed; delivery and PIT universe/action completeness not established | Current personal-use terms, permitted endpoint access, adjustments and redistribution not verified | No automatic fallback; not selected |

No numeric provider quota is asserted without evidence. The importer's configured caps are **operator-set safety budgets**, not advertised free allowances. TejHQ/Breeze API URLs, authentication and pricing are deliberately not guessed.

Recommended initial path: operator-held official daily files obtained under confirmed free personal-use permission, imported privately, with explicit session calendar/master/action evidence. This recommendation is conditional on terms verification. Breeze can be reconsidered only after existing-account eligibility, zero charges and usage rights are established. There is currently no verified free source covering every requested dataset and historical bias control.

Network additions were saved to the environment configuration draft, preserving existing domains. Saving a draft did not apply them: the running environment remained on revision 10 with only the prior custom grants when checked. The user needs to save/apply the reviewed network changes and publish the configuration. Provider-site denials were cloud policy denials, not proof the providers are unavailable or unsuitable.

## Actual historical validation: not yet available

| Example | Price evidence | Reversal / HL / BOS / confirmed / strong dates | Volume / RS / difference from observed date |
| --- | --- | --- | --- |
| Punjab National Bank (`PNB`), observation 9 October 2026 | Not imported or independently verified | Not reported | Unavailable |
| HDFC Life (`HDFCLIFE`), observation November 2026 | Not imported or independently verified | Not reported | Unavailable; a month is not an exact comparison date |
| PTC Industries (`PTCIL`; verify source symbol/ISIN) | Not imported or independently verified | Not reported | Unavailable |
| Kirloskar Oil Engines (`KIRLOSENG`; verify source symbol/ISIN) | Not imported or independently verified | Not reported | Unavailable |

The validation command selects these symbols from the supplied master. It reports every detected episode, raw imported prices, the first confirmed HL's pivot and availability dates, initial reversal, first BOS, first confirmation, strong status, volume ratio and RS against actual supplied Nifty 500 price history. It does not pass example dates to the engine. Price provenance remains source-dependent; prefix checks establish calculation consistency, not independent exchange-price accuracy. Observation-date differences must be calculated only after an actual identified episode and a precise observation date are available; no date matching is forced.

No real-data 20/40/60-session performance or profitable edge can be reported. The report runner retains the existing next-open, cost/slippage, split/bonus/dividend and censoring rules. It computes initial/confirmed cohorts and volume >=1.2x / <1.2x / unavailable cohorts. Regime is recorded at the signal date. Missing delisted-universe or corporate-action attestations block backtests; a four-surviving-stock convenience sample must not be marked historical-universe complete to bypass that gate. Delisting records, noncash mergers, unsupported events and incomplete index memberships remain material limitations.

## Resource and cost estimates

- **New service commitments: ₹0/month.** No service provisioning, payment method, automatic upgrade or paid scheduler was used. Continued operation on an already-paid account cannot be certified from this workspace; billing settings must enforce the user's free-tier choice.
- The existing frontend can continue on its existing Vercel deployment, subject to that account's actual plan/allowances. Python workers/PostgreSQL have only been run locally for tests. No free hosted worker/database or remote private-service connection has been provisioned or verified.
- Reusing local hardware with PostgreSQL needs no additional service subscription. An always-running remote backend is still an unresolved deployment prerequisite; do not describe the cloud development workspace as permanent free hosting.
- Local files use **zero application API calls**. An approved daily bulk archive typically needs one request per explicitly configured source artifact; e.g. one NSE + one BSE file means two archive requests per covered session, excluding separately needed indices/actions/master files. This is a planning example, not a verified provider allowance. No intraday polling occurs.
- Network requests are counted before transmission, including failures. HTTP errors/429 or byte limits pause that feed for the remaining IST day. No retry, redirect, provider switching or paid fallback occurs. Cached archive URLs are not requested again. An official corrected file at the same URL needs explicit cache/source revision review.
- Rough payload planning at **250–500 bytes per normalized JSON candle**, before JSONB/index/version overhead: 4 equities × 750 sessions ≈0.75–1.5 MB per full version; 500 equities ≈94–188 MB; 5,000 equities ≈0.94–1.88 GB. Five 750-session index histories add about 0.3–0.6 MB. These are assumptions, not measurements of actual imported data. Immutable daily versions multiply retained storage. Broad NSE/BSE history will not fit the default budget.
- Default database budget: **100,000,000 bytes**, maximum configurable 500,000,000 bytes. PostgreSQL monitoring uses `pg_database_size`; SQLite uses approximate serialized dataset/result bytes. Writes reserve a 2× payload margin. PostgreSQL's physical expansion, WAL, managed backups/logs, network transfer and provider billing are not fully represented by this application guard; platform hard caps remain necessary. No software monitor can guarantee a provider's billing policy.
- Only one worker/process is supported. CLI updates should be serialized (the setup guide uses a nonblocking local file lock). Old run inputs are retained. There is no automatic destructive pruning to hide quota growth.

## Deployment and completion gates

Local fixture tests exercise import, database persistence, APIs and browser behavior. Production build/tests must pass before pushing. Live `/scanner.html` and private-service requests remain unverified while the deployment domain is blocked. No credentials have been exposed to the frontend, and no actual/restricted market datasets have been committed or exported to `public/`.

To complete the requested real-market integration: verify provider terms/zero-cost eligibility; obtain actual histories plus reliable calendar/master/actions/index/PIT membership data; import into the private service; run and inspect per-stock and backtest reports; configure a genuinely free/private reachable backend within hard quotas; then test the deployed app with that backend. Until then, the existing synthetic demo remains the only public scanner dataset.

## Executed local checks

- 94 Node tests passed.
- 45 Python tests passed, including a genuine disposable PostgreSQL import/idempotency roundtrip, private API checks, CLI default-parameter scan reuse, quota/caching failures and historical prefix checks on synthetic fixtures. No PostgreSQL test was skipped in this run.
- Scanner TypeScript check and Vite production build passed.
- Existing dashboard browser regression suite passed with controlled external responses.
- Scanner browser suite passed against PostgreSQL, including source/update UI, private token isolation, imports, queued scans/backtests, charts and demo separation.
- Updated backend Docker image built successfully. A nonroot container verified writable private cache storage and PostgreSQL market-status queries.
- Existing engine files and the published demo calculation provenance are unchanged.

These checks validate implementation behavior. They do not satisfy actual-history or deployed-service validation gates above.
