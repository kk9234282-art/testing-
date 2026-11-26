# Free market-data integration: evidence and outstanding gates

Audit date: 26 November 2026 (India). Budget: ₹0/month; no paid services, accounts, upgrades or fallback providers have been enabled.

**This integration is not yet validated with real-market data.** No real source has been selected, no actual NSE/BSE history has been imported in this task, and real-data deployment is not active. The public scanner HTML and private-service error responses have now been checked over HTTPS; live browser execution remains blocked by this runtime's certificate-trust error. The deployed demo must remain labelled synthetic. Contract fixtures and local PostgreSQL/browser tests are software verification, not evidence of actual prices, free provider eligibility or historical profitability.

## Existing project audit

The separate React scanner, FastAPI job API, PostgreSQL immutable input datasets and causal market-structure/backtest modules already exist. The engine uses confirmed ATR-filtered pivots, closing-price breaks, next-session entries and source completeness gates. A private same-origin bridge protects user-supplied tokens. These components are reused.

Missing operational pieces were CSV/ZIP conversion, incremental merge, artifact identity, import failures/update status, request budgets and a repeatable historical audit. Those have been added without modifying `structure.py`, `indicators.py`, `research.py`, `backtest.py` or `schema.py`. Extra breadth diagnostics are separate and do not change regime weights or signal rules. A database storage guard also covers original JSON imports and research result writes.

Existing storage retains complete immutable snapshots for reproducibility. This is appropriate for a small personal validation universe; it is **not** an efficient all-exchange multiyear warehouse. New daily candles are merged without re-downloading old source files, but new dataset versions still retain full input payloads. Operations stop at the configured storage budget. A larger warehouse would need a separately justified storage migration, which has not been performed.

## Provider comparison and evidence

| Source | Evidence obtained in this task | Coverage / fields established | Free quota and rights status | Decision |
| --- | --- | --- | --- | --- |
| TejHQ | User supplied the correct [keys URL](https://tejhq.dev/keys). Earlier `.com` probes were against the wrong domain. `tejhq.dev` returns proxy CONNECT 403 because the newly identified host is not in the active revision-12 allowlist; its exact-host addition has been saved as a new configuration draft | NSE/BSE, historical length, OHLCV, volume, delivery, actions and adjustments **unverified** | Free API availability, daily limits, personal use and redistribution **unverified** | First priority once the new host grant is applied; no provider chosen, endpoints guessed or account created |
| ICICI Breeze | Official [product/FAQ](https://www.icicidirect.com/futures-and-options/api/breeze), [API documentation](https://api.icicidirect.com/breezeapi/documents/index.html) and [SDK README](https://github.com/Idirect-Tech/Breeze-Python-SDK/blob/main/README.md) retrieved successfully | API introduction confirms NSE equity and explicitly says BSE/MCX securities are unavailable. SDK advertises ten years of history; FAQ's three-year statement concerns F&O. Neither proves actual four-stock coverage. Delivery, adjustments, full corporate actions and all requested indices remain unverified | Product FAQ says API/data access is free to ICICIdirect customers. API introduction confirms **100 calls/minute, 5,000/day**. Data redistribution rights remain unverified; no inference from SDK licensing | User confirms **no existing Breeze account**. Not activated; no account opened, account-maintenance cost assumed, credentials requested in chat or trading endpoint used |
| Official NSE/BSE daily files | [NSE current master CSV](https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv) returned HTTP 200 with **2,634 entries**, including all four example symbols. NSE main-site terms requests still fail through the proxy; BSE home returned HTTP 403 | The current master establishes symbol-list availability only, not historical membership/sector versions, equity-only classification, OHLCV, adjustment conventions or survivorship-safe coverage. Daily candle contracts remain fixture-tested, not actual-file-validated | Public download availability does not establish retention, automation or redistribution rights. NSE/BSE applicable personal-use terms remain unresolved | No historical bundle imported or source approved. Current master was inspected privately for provider research only, not turned into invented past universe versions |
| Nifty Indices official history | [History page](https://www.niftyindices.com/reports/historical-data), [terms](https://www.niftyindices.com/terms-of-use) and [disclaimer](https://www.niftyindices.com/disclaimer) returned HTTP 200 | History page exists; exact five-index time-series coverage/PIT constituent history not obtained or imported | Terms limit site use to personal/noncommercial purposes but also reserve copying/distribution rights and require **express written consent for systematic or automated collection**. Personal use alone is not an automated-data licence | Not selected as an unrestricted API. Network ingestion now requires a separate recorded written-automation-consent reference; no index candles scraped |
| Yahoo Finance | Finance page returned HTTP 429; existing chart code is not source permission | No source-qualified actual historical import performed; delivery and PIT universe/action completeness not established | Current endpoint-use/adjustment/redistribution terms remain unverified | No retry loop or automatic fallback; not selected |

The Breeze quota above is supported by its official API introduction, not order-placement limits. The importer's configured caps are **operator-set safety budgets**, not advertised free allowances. TejHQ endpoints are not guessed. No authenticated Breeze request has been made.

Recommended initial path: operator-held official daily files obtained under confirmed free personal-use permission, imported privately, with explicit session calendar/master/action evidence. This recommendation is conditional on terms verification. Breeze is conditionally free for existing customers, but the user has no account and it does not cover BSE according to its current API documentation. It has not been selected. There is currently no verified free source covering every requested dataset and historical bias control.

The approved allowlist is now applied: environment status reports current/enforced revision **12**, including the requested provider and deployment hosts. The earlier revision-10 blocker has been resolved. Remaining failures are reported per host; repeating the old instruction to apply the same draft would be incorrect. The newly supplied correct TejHQ host `tejhq.dev` needs its separate grant applied (saved in a follow-up draft); Breeze requires an eligible account; Nifty automation needs express consent. None of those prerequisites is satisfied by network access alone.

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

Local fixture tests exercise import, database persistence, APIs and browser behavior. Production build/tests must pass before pushing. Actual HTTPS checks now show `/scanner.html` returns HTTP 200 and both `/api/structure/health` and `/api/structure/datasets` return HTTP 503 with `Private scanner service is not configured`. All four JavaScript/CSS assets referenced by the scanner HTML also returned HTTP 200. The deployed demo JSON is labelled `sample` and contains 15 rows. This verifies the public-page endpoint and missing-backend state, not rendered browser functionality. Headless Chromium navigation failed with `ERR_CERT_AUTHORITY_INVALID` against the environment proxy; TLS verification was not disabled and no live-browser pass is claimed. No credentials have been exposed to the frontend, and no actual/restricted market datasets have been committed or exported to `public/`.

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


## Follow-up verification (network revision 12)

The new Nifty automation-consent guard is covered by a regression test. It does not change the market-structure algorithm. A suitable source or operator-held historical export with applicable personal-use permission is still required before any real prices, transition dates, RS or return statistics can be reported. No new accounts, subscriptions or paid services were created.

Latest follow-up checks: 46 Python tests ran successfully (45 passed; the PostgreSQL-only test was skipped because a disposable PostgreSQL URL was not supplied in this resumed runtime). The production build passed. The earlier 45-test PostgreSQL run remains recorded separately above; it is not claimed as a new run. Provider access is still pending the newly supplied `tejhq.dev` grant.
