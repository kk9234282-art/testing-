# Private zero-cost EOD updates

See [evidence and limitations](FREE_MARKET_DATA_REPORT.md) before choosing a source. No source is preapproved. Do not copy synthetic prices/master records into a real dataset. `licensed` in the existing import schema means permission to use the data; it does not require a paid subscription.

## Prepare actual private inputs

Keep all real exports/config/reports under `.scanner-private/` (gitignored), outside `public/` and `dist/`. Copy `scanner_service/examples/free-update.template.json` there. The template deliberately fails validation until real permission and metadata are supplied. Do not set its confirmations to true merely to make an import pass. Record the applicable terms/permission reference and verification date (within 90 days); keep network access disabled for local files. No credentials belong in this configuration.

Supply metadata in the [existing import format](../STRUCTURE_SCANNER.md):

- Actual ordered exchange sessions, not weekdays generated from the first/last price and not the union of observed candles. Include missing expected sessions so gaps are detectable. Sessions beyond the finalized watermark must not have prices.
- Point-in-time security versions with stable security ID, valid ISIN/checksum, listing IDs, sector, instrument type, effective and known dates. Current symbol/constituent downloads cannot establish a complete historical universe. NSE/BSE listings with the same economic security must use the same security ID; NSE is preferred by the existing engine.
- Raw, finalized OHLCV. Adjusted OHLC plus the same actions would double-adjust and is rejected by the raw-only contract. Source conventions must actually be verified; changing a label does not unadjust prices.
- Verified split/bonus/dividend factors and known/effective dates. The existing engine performs causal rebasing and raw-price holding accounting. Missing action data must be disclosed, not treated as zero actions. Do not claim completeness without evidence. Noncash mergers need separate support; leave affected performance unverified.
- Canonical index metadata, price-index candles and historical constituent memberships. IDs: `NIFTY_500`, `NIFTY_50`, `NIFTY_MIDCAP_150`, `NIFTY_SMALLCAP_250`, `NIFTY_50_EQUAL_WEIGHT`, plus desired sector indices. An expected member count must reflect supplied verified membership. A small watchlist is not Nifty 500.

Keep `bars`/`index_bars` out of metadata; the files below provide them. `manifest.license_reference` must equal the permission reference. Preserve old session dates and all historical master/action versions in daily metadata. New candles and new reference records are merged; identical duplicates are idempotent. Conflicting records stop the update. A legitimate historical correction or closing an earlier open master interval needs a reviewed new source/feed version, not an unnoticed overwrite of saved research.

Supported input contracts (case-insensitive headers; UTF-8 CSV, optional single-member ZIP):

| `format` | Required identifiers / date | Prices and volume |
| --- | --- | --- |
| `nse-legacy` | `SYMBOL`, `SERIES=EQ`, `TIMESTAMP` | `OPEN,HIGH,LOW,CLOSE,TOTTRDQTY` |
| `nse-udiff` | `TradDt,Sgmt=CM,FinInstrmTp=STK,TckrSymb,SctySrs=EQ`; ISIN checked if present | `OpnPric,HghPric,LwPric,ClsPric,TtlTradgVol` |
| `bse-legacy` | `SC_CODE`; explicit `session` if no date column | `OPEN,HIGH,LOW,CLOSE,NO_OF_SHRS` |
| `bse-udiff` | `TradDt,Sgmt=CM,FinInstrmTp=STK,FinInstrmId` (must map to verified BSE listing code) | `OpnPric,HghPric,LwPric,ClsPric,TtlTradgVol` |
| `bars` | `listing_id,date` (normalized private exports) | `open,high,low,close,volume` |
| `indices` | `Date` plus explicit canonical `index_id`, or `INDEX_ID` column | `Close` or `Closing Index Value`; price index, not total-return index |

Dates: ISO, `DD-Mon-YYYY`, `DD-MM-YYYY`, `DD/MM/YYYY` or `DD-Mon-YY`. No price/volume interpolation. Negative/nonfinite volume and invalid OHLC are rejected. Untracked or non-equity rows are counted and skipped using the explicit master; unknown instruments are never added as presumed equities. Only supported NSE EQ-series ordinary equity is ingested. Other equity series such as BE/SM are currently excluded; this is not complete NSE equity coverage. Unsupported/changed official formats stop the import and require adaptation after inspecting a real source file.

Delivery percentage is optional (`DELIV_PER`/`DELIVERY_PCT`) and marked reliable only with explicit `delivery_verified: true` on that verified artifact. No delivery values are derived from total trading volume. `zip_member` selects a CSV when an archive contains several; archives are never extracted to disk.

## Run manually on existing local infrastructure

Install the pinned Python requirements and start PostgreSQL/the existing service as described in [the scanner guide](../STRUCTURE_SCANNER.md). Set `SCANNER_DATABASE_URL` privately; never put its value in GitHub or a frontend variable. Default database budget is 100 MB; keep the configured cap below the actual free plan's hard limit, including room for system overhead. The same guard now covers original bundle imports and research results. Do not raise it to bypass a provider's storage limit.

```sh
python -m scanner_service.market_cli update .scanner-private/update.json --scan
python -m scanner_service.market_cli status
python -m scanner_service.market_cli validate DATASET_SHA --every-prefix --output .scanner-private/history-validation.json
python -m scanner_service.market_cli breadth DATASET_SHA --output .scanner-private/breadth.json
```

With the existing local Compose setup (no hosted plan provisioned):

```sh
docker compose --env-file .env.scanner -f compose.scanner.yml up -d
docker compose --env-file .env.scanner -f compose.scanner.yml exec scanner python -m scanner_service.market_cli update /imports/update.json --scan
```

Compose maps `.scanner-private/imports` read-only to `/imports`; source paths in that config must use `/imports/...`. The download cache is a private named volume. No database port is exposed. The worker remains loopback-bound. Add no broker keys to frontend environment variables.

The command writes a new immutable dataset only when content changes, records hashes/errors, updates the feed watermark only on a successful transaction, and queues/reuses an existing normal EOD scan. A successful scan still reports missing candles. Per-stock annotations stay withheld when the existing engine's complete-history rule fails. Backtest/report commands do not bypass history-completeness requirements. The extra above-20-EMA / A-D ratio / structure counts and sector mean stock-RS metrics are diagnostics only; original regime scoring is unchanged.

In the scanner, select Private imported history, enter the service token and Connect. Dataset selection and Run EOD scan use the normal protected API. Connect refreshes dataset/update status; the page shows source, finalized watermark, last successful import/update, stale warnings and request/storage usage when supported. No missing real results are replaced by demo values. Restricted source data must stay behind the private backend; no public real-data bundle is generated.

## Optional archive downloads and scheduling

No provider API is enabled automatically. Nifty Indices specifically prohibits systematic/automated collection without express written consent. For `provider: "indices"`, network mode additionally requires `written_automation_permission_reference` pointing to actual consent; its general personal-use terms are insufficient. An operator-set flag does not create permission. After verifying official automated-download terms, set the correct official provider, `network_download_permitted`, a nonzero verified free `daily_request_limit` and `daily_download_bytes`, and give an exact HTTPS archive `url` plus its explicit finalized `session`. Hosts are restricted to `nsearchives.nseindia.com`, `www.bseindia.com` or `www.niftyindices.com` for the chosen provider. No credentials, query strings, redirects, auth endpoints, cookie tricks, browser-challenge bypasses, guessed TejHQ/Breeze endpoints or automatic fallback are supported.

Each request is reserved durably before transmission; failures count. Errors/429 and download limits pause the feed until the next IST day. Archive URLs are cached privately. Daily configs should include only new/missing source artifacts, using the supplied calendar and the last successful watermark; resubmitting old URL entries uses the local cache. Cached data is not automatically redownloaded even if a provider revises it: review source corrections explicitly. Local files incur no application API quota; the app cannot account for downloads made outside it.

No free hosted scheduler is verified or enabled. The manual command is the supported default. On an already available local Linux machine, an optional existing cron can run it at 19:30 IST after files are supplied. For a host configured to **UTC**, this example is 14:00 UTC Monday–Friday; set absolute paths to the real checkout/virtualenv/config and create the private log directory first:

```cron
0 14 * * 1-5 cd /absolute/project && /usr/bin/flock -n .scanner-private/update.lock /absolute/venv/bin/python -m scanner_service.market_cli update .scanner-private/update.json --scan >> .scanner-private/update.log 2>&1
```

This is an example, not an installed job. Verify the host timezone; do not assume `CRON_TZ` support. Holidays/new sessions must come from the actual calendar. A static config will not invent tomorrow's file URL or fetch provider metadata; that source-specific planning remains blocked on choosing/verifying a source. Re-running it doesn't redownload cached history. The command recomputes the current small-universe scan rather than introducing an unvalidated incremental signal engine. No Vercel paid cron or external scheduler is activated.

## Verify

```sh
npm test
python -m unittest discover -s scanner_service/tests -v
npm run typecheck:scanner
npm run build
npm run test:browser
SCANNER_PYTHON=/absolute/venv/bin/python npm run test:scanner:browser
```

For genuine PostgreSQL integration set `SCANNER_TEST_DATABASE_URL` to a disposable test database before Python/browser tests. Tests use synthetic contract fixtures and never certify source terms, real historical outcomes or deployment. Do not point them at a database containing personal imported data. The report command must subsequently run on the actual imported dataset, with evidence inspected, before declaring real-market integration complete.
