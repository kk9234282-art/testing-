# Free market-data integration: evidence and outstanding gates

Audit date: 26 November 2026 (India). Budget: ₹0/month; no paid services, accounts, upgrades or fallback providers have been enabled.

**Real-data ingestion has started, but validated scanning is not complete.** TejHQ's keyless endpoints returned actual source histories for PNB, HDFCLIFE, PTCIL and KIRLOSENG: **720 candles each, 2,880 total**, 2024-01-01 through 2026-11-25. They have been imported into an isolated private PostgreSQL raw-staging area, with original action responses and source hashes retained privately. The same data is now available in a raw-view-only private dataset after source-level calendar/identity checks; action publication/adjustment evidence is still not approved for signals. No transition dates, RS, real-market backtest results or profitable edge are certified. The public Vercel scanner remains synthetic and its private backend is unconfigured.

## Existing project audit

The separate React scanner, FastAPI job API, PostgreSQL immutable input datasets and causal market-structure/backtest modules already exist. The engine uses confirmed ATR-filtered pivots, closing-price breaks, next-session entries and source completeness gates. A private same-origin bridge protects user-supplied tokens. These components are reused.

Missing operational pieces were CSV/ZIP conversion, incremental merge, artifact identity, import failures/update status, request budgets and a repeatable historical audit. Those have been added without modifying `structure.py`, `indicators.py`, `research.py`, `backtest.py` or `schema.py`. A source-quality gate outside the engine now withholds signals, indicators and annotated levels for real research inputs whose corporate-action completeness is not attested. Raw charts remain available for such bundles; raw quarantine captures are listed separately until metadata permits promotion. Extra breadth diagnostics are separate and do not change regime weights or signal rules. A database storage guard also covers original JSON imports and research result writes.

Existing storage retains complete immutable snapshots for reproducibility. This is appropriate for a small personal validation universe; it is **not** an efficient all-exchange multiyear warehouse. New daily candles are merged without re-downloading old source files, but new dataset versions still retain full input payloads. Operations stop at the configured storage budget. A larger warehouse would need a separately justified storage migration, which has not been performed.

## Provider comparison and evidence

| Source | Evidence obtained in this task | Coverage / fields established | Free quota and rights status | Decision |
| --- | --- | --- | --- | --- |
| TejHQ | [Keys](https://tejhq.dev/keys), [terms](https://tejhq.dev/data-terms), [OpenAPI](https://api.tejhq.dev/openapi.yaml), status and eight actual keyless history/action responses fetched successfully | Actual four-stock NSE responses contain 720 raw OHLCV candles each; action envelopes and raw subjects are available. Provider status reports trading date **2026-11-25**, prices published **2026-11-26 00:03:02 UTC**, derived **00:07:01 UTC**. Other exchanges/full-universe coverage is still documentation-only. No Nifty index values/official constituents | Free personal research, local storage and private dashboards permitted by TejHQ terms. Keyless: 500/day/IP, reset 05:30 IST; five requests/ten seconds/IP shared with status. No signup used. Provider explicitly has no exchange licence and cannot grant exchange rights. Raw redistribution prohibited | Keyless raw source integrated privately with conservative caps; 2,880 prices quarantined in PostgreSQL. Not a licensed exchange feed or complete validated scanner. No paid/key/signup endpoints used |
| ICICI Breeze | Official [product/FAQ](https://www.icicidirect.com/futures-and-options/api/breeze), [API documentation](https://api.icicidirect.com/breezeapi/documents/index.html) and [SDK README](https://github.com/Idirect-Tech/Breeze-Python-SDK/blob/main/README.md) retrieved successfully | API introduction confirms NSE equity and explicitly says BSE/MCX securities are unavailable. SDK advertises ten years of history; FAQ's three-year statement concerns F&O. Neither proves actual four-stock coverage. Delivery, adjustments, full corporate actions and all requested indices remain unverified | Product FAQ says API/data access is free to ICICIdirect customers. API introduction confirms **100 calls/minute, 5,000/day**. Data redistribution rights remain unverified; no inference from SDK licensing | User confirms **no existing Breeze account**. Not activated; no account opened, account-maintenance cost assumed, credentials requested in chat or trading endpoint used |
| Official NSE/BSE daily files | [NSE current master CSV](https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv) returned HTTP 200 with **2,634 entries**, including all four example symbols. NSE’s terms URL redirects to `www.nseindia.in` (grant saved for the next check); BSE home returned HTTP 403 | The current master establishes symbol-list availability only, not historical membership/sector versions, equity-only classification, OHLCV, adjustment conventions or survivorship-safe coverage. Daily candle contracts remain fixture-tested, not actual-file-validated | Public download availability does not establish retention, automation or redistribution rights. NSE/BSE applicable personal-use terms remain unresolved | No approved historical research bundle imported from these official files. Current master was inspected privately for provider research only, not turned into invented past universe versions |
| Nifty Indices official history | [History page](https://www.niftyindices.com/reports/historical-data), [terms](https://www.niftyindices.com/terms-of-use) and [disclaimer](https://www.niftyindices.com/disclaimer) returned HTTP 200 | History page exists; exact five-index time-series coverage/PIT constituent history not obtained or imported | Terms limit site use to personal/noncommercial purposes but also reserve copying/distribution rights and require **express written consent for systematic or automated collection**. Personal use alone is not an automated-data licence | Not selected as an unrestricted API. Network ingestion now requires a separate recorded written-automation-consent reference; no index candles scraped |
| Yahoo Finance | Finance page returned HTTP 429; existing chart code is not source permission | No source-qualified actual historical import performed; delivery and PIT universe/action completeness not established | Current endpoint-use/adjustment/redistribution terms remain unverified | No retry loop or automatic fallback; not selected |

The Breeze quota above is supported by its official API introduction, not order-placement limits. The importer's configured caps are **operator-set safety budgets**, not advertised free allowances. TejHQ quotas/permissions now come from its live data-terms page, updated 2026-11-26. Actual endpoint response contracts must still be checked against its documented OpenAPI spec; endpoint parameters are not guessed. No authenticated Breeze request has been made.

Current path: the keyless adapter captures actual raw histories and actions, caches them privately and writes raw prices to PostgreSQL without inventing research metadata. Approved imports can later reuse the existing CSV/bundle path with reviewed calendars, point-in-time identities and action factors/availability. TejHQ's permission covers its service/packaging only; exchange rights remain unresolved. Its liquidity universe is not Nifty 500 or official sector/index membership.

The cleaned-up allowlist is active at revision **20**, including the observed Hugging Face CDN. Seven files from revision `298763bfd8af97d47ed01910396849057dba0ad1` total 50,803,494 bytes; published SHA-256 checks passed. Source-level review covered the dates in **1,747,783 NSE rows**, found **720 observed sessions** and compared all 2,880 selected OHLCV candles with the API: zero differences or missing sessions relative to those source dates. The four stable ISINs match the current master for the reviewed period. Action responses also match across interfaces; PNB’s four stale-ISIN action rows remain flagged, not corrected or applied. PTCIL includes BE as well as EQ series in 2024.

The observed dates also match the provider’s declared holiday/special-session calendar at pipeline commit `4cb971319e20374b7901207f522c9f48eaa9b35a`: 720 expected/observed, no differences. This is another provider consistency check, not independent exchange certification. Actual raw-price charts passed authenticated local browser/API tests.

The user explicitly chose strict verification: no ex-date-close assumption replaces missing historical publication timestamps. Signals, indicators and real backtest statistics remain withheld. NSE’s `.com` terms URL now returns an observed 301 redirect to **`www.nseindia.in`**; that exact host is saved in a new network draft for the next official-source terms/announcement check. No wildcard grants or access bypasses were added.

## Actual historical validation: raw evidence available, structural validation withheld

| Example | Price evidence | Reversal / HL / BOS / confirmed / strong dates | Volume / RS / difference from observed date |
| --- | --- | --- | --- |
| Punjab National Bank (`PNB`), observation 9 October 2026 | 720 source candles imported privately; not independently exchange-certified | Withheld pending source metadata review | RS unavailable: no Nifty 500 history; no dates fitted |
| HDFC Life (`HDFCLIFE`), observation November 2026 | 720 source candles imported privately; not independently exchange-certified | Withheld pending source metadata review | RS unavailable: no Nifty 500 history; no dates fitted; a month is not an exact comparison date |
| PTC Industries (`PTCIL`; verify source symbol/ISIN) | 720 source candles imported privately; not independently exchange-certified | Withheld pending source metadata review | RS unavailable: no Nifty 500 history; no dates fitted |
| Kirloskar Oil Engines (`KIRLOSENG`; verify source symbol/ISIN) | 720 source candles imported privately; not independently exchange-certified | Withheld pending source metadata review | RS unavailable: no Nifty 500 history; no dates fitted |

The private capture report includes all raw candles, the requested PNB observation-day candle and HDFCLIFE November rows; it does not force these observations into the algorithm. PNB action responses show a source ISIN mismatch with the current official NSE master, which is retained for review rather than silently resolved. Announcement timestamps are absent from the documented action schema. No historical `known_on` dates are manufactured.

For approved data, the validation command selects these symbols from the supplied master. It reports every detected episode, raw imported prices, the first confirmed HL's pivot and availability dates, initial reversal, first BOS, first confirmation, strong status, volume ratio and RS against actual supplied Nifty 500 price history. It does not pass example dates to the engine. Price provenance remains source-dependent; prefix checks establish calculation consistency, not independent exchange-price accuracy. Observation-date differences must be calculated only after an actual identified episode and a precise observation date are available; no date matching is forced.

No real-data 20/40/60-session performance or profitable edge can be reported. The report runner retains the existing next-open, cost/slippage, split/bonus/dividend and censoring rules. It computes initial/confirmed cohorts and volume >=1.2x / <1.2x / unavailable cohorts. Regime is recorded at the signal date. Missing delisted-universe or corporate-action attestations block backtests; a four-surviving-stock convenience sample must not be marked historical-universe complete to bypass that gate. Delisting records, noncash mergers, unsupported events and incomplete index memberships remain material limitations.

## Resource and cost estimates

- **New service commitments: ₹0/month.** No service provisioning, payment method, automatic upgrade or paid scheduler was used. Continued operation on an already-paid account cannot be certified from this workspace; billing settings must enforce the user's free-tier choice.
- The existing frontend can continue on its existing Vercel deployment, subject to that account's actual plan/allowances. Python workers/PostgreSQL have been run locally for tests and the private real-data capture; no permanent hosted backend is active. No free hosted worker/database or remote private-service connection has been provisioned or verified.
- Reusing local hardware with PostgreSQL needs no additional service subscription. An always-running remote backend is still an unresolved deployment prerequisite; do not describe the cloud development workspace as permanent free hosting.
- Local files use **zero application API calls**. An approved daily bulk archive typically needs one request per explicitly configured source artifact; e.g. one NSE + one BSE file means two archive requests per covered session, excluding separately needed indices/actions/master files. This is a planning example, not a verified provider allowance. No intraday polling occurs.
- Network requests are counted before transmission, including failures. HTTP errors/429 or byte limits pause that feed for the remaining IST day. No retry, redirect, provider switching or paid fallback occurs. Cached archive URLs are not requested again. An official corrected file at the same URL needs explicit cache/source revision review.
- Rough payload planning at **250–500 bytes per normalized JSON candle**, before JSONB/index/version overhead: 4 equities × 750 sessions ≈0.75–1.5 MB per full version; 500 equities ≈94–188 MB; 5,000 equities ≈0.94–1.88 GB. Five 750-session index histories add about 0.3–0.6 MB. These are assumptions, not measurements of actual imported data. Immutable daily versions multiply retained storage. Broad NSE/BSE history will not fit the default budget.
- Default database budget: **100,000,000 bytes**, maximum configurable 500,000,000 bytes. PostgreSQL monitoring uses `pg_database_size`; SQLite uses approximate serialized dataset/result bytes. Writes reserve a 2× payload margin. PostgreSQL's physical expansion, WAL, managed backups/logs, network transfer and provider billing are not fully represented by this application guard; platform hard caps remain necessary. No software monitor can guarantee a provider's billing policy.
- Only one worker/process is supported. The live raw-staging database measured about **9.46 MB**, including PostgreSQL overhead; cached four-stock responses about **0.55 MB**. Nine market-data requests (one status plus eight history/action calls) were tracked for the actual import; captures were reused without re-downloading. These are small-scope observations, not all-market storage estimates. Raw candles have unique exchange/symbol/session keys and conflicting corrections stop for review.
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

The new Nifty automation-consent guard is covered by a regression test. It does not change the market-structure algorithm. Actual TejHQ prices are now imported privately, but reviewed metadata and benchmark inputs are still required before validated transition dates, RS or return statistics can be reported. No new accounts, subscriptions or paid services were created.

Latest follow-up checks: 46 Python tests ran successfully (45 passed; the PostgreSQL-only test was skipped because a disposable PostgreSQL URL was not supplied in this resumed runtime). The production build passed. The earlier 45-test PostgreSQL run remains recorded separately above; it is not claimed as a new run. Later revision-18 checks resolved website/API access; the later revision-20 check resolved bulk access; only the newly observed NSE `.in` redirect remains pending.


## TejHQ data limits to preserve during integration

- Prefer keyless raw prices/actions plus validated conversion. Free adjusted data and delivery require email registration; no account/key has been requested or created. No paid Retail/Pro/F&O route may be used.
- Keyless quotas reset at 05:30 IST (00:00 UTC), not the existing generic file importer's IST-midnight counter. A TejHQ adapter must use that reset boundary and the shared five-per-ten-second cap across OHLCV, actions, snapshot and status calls; the current generic official-file downloader is **not** a TejHQ API client.
- Provider adjusted output has raw OHLC plus `adj_close`/cumulative factors. Never feed a mixture of adjusted closes and raw OHLC into the existing raw-only import format or apply the same action twice. Preserve raw source bars and explicit action factors.
- Provider actions document ex/record dates but do not document announcement/first-publication timestamps in the README schema. Do not invent historical knowledge timestamps or attest complete point-in-time corporate-action history without inspecting source evidence. Unsupported mergers/demergers/rights are not automatically fixed by a factor of one.
- The provider chains some ISIN transitions heuristically (same symbol, short gap); that is not authoritative evidence that every merger/rename belongs to one stable economic security. Identity changes outside the selected stable-ISIN period still require review.
- NSE pre-2012 raw rows can lack ISIN. BSE starts in July 2024. These limitations must remain visible and must not be labelled a complete all-exchange historical universe.
- Provider terms say data is usually ready next morning IST with no free SLA. Check `/v1/status` after access is active; documentation saying “to today” does not verify actual freshness or coverage of the October/November 2026 example dates.


## Executed keyless integration checks (revision 18)

- 61 Python tests passed against a disposable PostgreSQL database, including raw-capture idempotency, UTC quota reset/burst pacing, 429 pause, keyless endpoint restrictions, incremental approved sync and unverified-action quality gates. No PostgreSQL case was skipped in that run.
- 94 Node tests, TypeScript and production build passed. Both the old dashboard browser audit and the scanner PostgreSQL browser suite passed; the scanner audit additionally checks that an incomplete real-source contract cannot publish signal dates or annotated pivots.
- An actual local private PostgreSQL database contains 2,880 provider candles. A separate browser/API/bridge check against that database passed: four staging listings, proper authentication, no synthetic fallback, no approved dataset invented and no persisted owner token. A private SQL backup and four-stock evidence report were created outside Git.
- Algorithm source files and published synthetic demo provenance are unchanged. The new source-quality presentation gate is separate from the mathematical methodology.

These results establish working ingestion and local quarantine behavior, not completed real-market structure/backtest validation or a deployed private service. See [TejHQ import guide](TEJHQ_IMPORT.md).

The final backend container also built and passed its nonroot cache/PostgreSQL/status check without making a provider request. Same-day EOD capture is accepted only after the local market-close guard; no intraday data is accepted as finalized.


## Strict raw-view follow-up

The optional offline reviewer verifies pinned artifact size/hash/path/revision, compares API OHLCV and action envelopes, checks dated source identities and emits raw-view-only CSV/metadata. It does not guess action publication times or apply factors. Existing private stock pages now show actual unadjusted candles/volume with an explicit raw-only accessible label and caption, while classifications and backtests stay unavailable. The original engine source/provenance is unchanged.

The public Vercel app still serves the separate synthetic demo; the private backend has not been remotely deployed. Scope is four NSE equities, not validated all-exchange coverage. No paid provider, account, hosting, database plan or scheduler was enabled.


## Bulk/price-view verification (revision 20)

- All seven downloaded artifacts passed published size/SHA-256 checks at one pinned revision. The 2,880 selected API candles and their action records match the bulk interfaces. No selected candle is missing from the 720 full-market observed dates; the same 720 dates agree with the provider’s declared calendar. This verifies provider consistency, not independent exchange accuracy.
- Raw-view CSV/metadata were imported through the existing private PostgreSQL workflow. The four actual stock pages render raw prices/volume. No action factors, announcement dates, trading signals or benchmark values were invented. Strict verification was explicitly selected by the user and remains enforced.
- PNB changed ISIN in the provider history on 2014-12-19; its four 2024–2026 stale-ISIN action rows remain flagged, including an AGM row. Source code also contains an inferred-split routine based on unexplained price steps; this is another reason not to auto-approve adjusted data. No inferred split was found among the selected stocks’ reviewed events.
- 73 Python tests passed with the optional Parquet dependency and PostgreSQL integration enabled; 94 Node tests, TypeScript, production build, both browser suites and the actual private-chart browser/API check passed. The original engine/demo provenance is unchanged.

The tool is still not a fully validated real-market scanner: historical action availability/factor approval, permitted Nifty/index membership data, full historical equity-universe/delisting coverage and a remotely configured private backend remain unresolved. The public app remains the labelled demo.
