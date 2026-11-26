# TejHQ: private keyless ingestion

TejHQ's [data terms](https://tejhq.dev/data-terms), checked 26 November 2026, permit free personal research, local storage, backtesting and private dashboards. They do not permit raw redistribution and explicitly say TejHQ holds no exchange licence; exchange rights apply independently. Its MIT code licence is not a market-data licence. Do not publish captures in the public Vercel deployment. No account, email, API key, paid endpoint or subscription is used here.

## Current result and limits

Actual responses for PNB, HDFCLIFE, PTCIL and KIRLOSENG have been fetched and **2,880 raw candles** imported into a separate private PostgreSQL staging area: 720 each, 2024-01-01–2026-11-25. Original action JSON and source hashes are retained privately. Nine keyless market-data requests were tracked; the import reused those cached captures. The private database occupied approximately 9.46 MB including PostgreSQL overhead; response cache approximately 0.55 MB. No real input data or connection secrets are committed to GitHub.

The captures are retained in quarantine, and a **raw-view-only dataset** is now connected to the existing private charts. This is not a validated signal/backtest dataset. The full-market files supply 720 observed sessions; all 2,880 API candles agree with bulk OHLCV, and the four ISIN histories agree with the current master over this period. This is provider consistency, not independent exchange certification. Corporate-action availability remains unverified. These are not invented from a current master or the four stocks' shared price dates. PNB's action ISIN differs from the current NSE master; it is flagged, not silently mapped. The action schema lacks announcement/publication timestamps. No `known_on` dates or adjustment factors are invented, and no real transition dates/returns are certified.

The source supplies no Nifty index values or official index/sector constituent history. Its monthly liquidity universe is its own turnover-ranked list and cannot be relabelled Nifty 500. NSE/BSE all-equity coverage, exclusions, historical metadata and delistings are not established by a four-stock convenience sample. The public website remains the explicitly synthetic demo; no remotely hosted private backend has been configured.

## Capture raw history

Use an existing local/private PostgreSQL database and the pinned Python environment from the [setup guide](FREE_MARKET_DATA_SETUP.md). Configure `SCANNER_DATABASE_URL` and storage budget privately. Do not run tests against a database containing personal captures.

```sh
python -m scanner_service.tejhq --capture NSE:PNB NSE:HDFCLIFE NSE:PTCIL NSE:KIRLOSENG \
  --from-date 2024-01-01 --output .scanner-private/tejhq/raw-import-report.json
```

This stores validated finite/positive OHLC geometry and nonnegative volume in `structure_tejhq_raw_candles`, uniquely keyed by exchange/symbol/session. It retains original action responses in `structure_tejhq_captures` without converting them into approved corporate actions. Later captures append only dates after the last stored candle, up to the provider's finalized date. If the provider hasn't advanced, raw history is not requested again. Conflicting revisions stop for review. Raw staging cannot detect shared missing exchange sessions without a verified calendar; it must not be used as evidence that history is gap-free. Repair/research promotion uses the calendar-based sync below.

Private connection information, source captures, the local report and a PostgreSQL SQL backup from this task are under `.scanner-private/tejhq/` (gitignored, private permissions). The development PostgreSQL volume is `tickr-tejhq-private-pg`, container `tickr-tejhq-pg`; only loopback port 55432 is published. The personal capture database is `structure_private`, owned by a separate role with a generated password. Disposable tests use database `structure`; they must not use the private connection settings. A cloud development workspace is not a permanent free hosting promise; keep the private backup outside it if needed.

## Promote reviewed inputs through the existing importer

Supply a private JSON configuration:

```json
{
  "feed_id": "tejhq-reviewed",
  "metadata_path": ".scanner-private/tejhq/reviewed-metadata.json",
  "listings": ["NSE:PNB", "NSE:HDFCLIFE", "NSE:PTCIL", "NSE:KIRLOSENG"],
  "permission_verified_on": "2026-11-26",
  "terms_reference": "https://tejhq.dev/data-terms",
  "daily_request_limit": 40,
  "daily_download_bytes": 25000000
}
```

The metadata file uses the existing Bundle's metadata fields, with no embedded bars. Use `manifest.source` identifying TejHQ and `license_reference` equal to its data-terms URL. Existing `kind: "licensed"` means permission to use the source, not a claim TejHQ has an exchange licence. Dates/identifiers/actions must actually be reviewed; do not turn completeness flags on to bypass missing evidence. All requested listings require explicit EQUITY master records; unknown ETFs or BSE/NSE aliases are not guessed.

```sh
python -m scanner_service.tejhq .scanner-private/tejhq/reviewed-sync.json
python -m scanner_service.cli scan DATASET_SHA
python -m scanner_service.market_cli validate DATASET_SHA --every-prefix \
  --output .scanner-private/tejhq/validated-research.json
```

The sync planner requests only missing contiguous blocks of the supplied actual exchange calendar. Raw prices are normalized to CSV and passed to the existing deduplicating/versioned importer. Actions remain in `tejhq-action-review.json`; they are not automatically attached. A claimed complete action history is rejected if financial events are absent from the supplied reviewed actions. Source publication/availability evidence still requires review; matching dates alone does not certify adjustment correctness. Old dataset/run inputs remain immutable.

A real bundle with unverified corporate-action completeness can retain prices, but the API/storage quality gate removes structural classifications/dates, confirmation indicators and regime/sector claims. Its stock detail shows raw candles without pivots/annotations. The validation report withholds structural dates. The existing backtest engine still rejects incomplete universe/action attestations. This is a data-quality rule outside the unchanged structure methodology; it does not fit signals to the user's examples. Synthetic demo behavior remains separate.

## Quotas, privacy and scheduling

Only `/v1/status`, `/v1/ohlcv`, `/v1/actions` and `/v1/snapshot` are allowed by the client. Billing, auth, keys, paid metrics/F&O/universe endpoints, redirects and arbitrary URLs are rejected. No authorization header is sent.

- Provider open quota: **500/day/IP**, resetting **05:30 IST (00:00 UTC)**; burst cap **five requests/ten seconds/IP**, including status.
- Client default: 40 requests/day and 25 MB/day; maximum configurable requests 400, retaining headroom. Reservations/errors count before transmission; persistent counters are shared across feeds. Requests are paced at least 2.2 seconds apart. Other apps sharing the egress IP cannot be counted locally; a provider limit/error pauses the client rather than retrying or upgrading.
- Status is cached for 30 minutes, historical ranges immutably, and action responses by latest provider trading date. Source revisions need explicit review rather than silent overwrites. Cache cap 100 MB; database budget applies to raw and research writes. SQLite monitoring now includes physical database/WAL files, not just research JSON.
- The private status endpoint shows raw capture counts, last capture time and tracked provider usage separately from approved datasets. Tokens stay in browser memory; there is no public raw-data endpoint or synthetic fallback.
- Manual execution is the default. The [existing optional local cron example](FREE_MARKET_DATA_SETUP.md) costs no scheduler subscription, but TejHQ usually publishes next morning IST: run after its status advances, e.g. 08:30 IST, not an assumption of immediate post-close availability. No hosted scheduler is enabled. A static local process is not an always-on free cloud service.

The bulk CDN grant is active at environment revision 20. Seven pinned artifacts (50,803,494 bytes) were downloaded and checked against published LFS SHA-256 values. Prices, dates, identities and action responses were compared without applying unverified actions. NSE’s terms page redirects to `www.nseindia.in`; that observed host is saved in a new draft for the next official rights/announcement check. No undocumented download workaround is used.


## Offline bulk review (optional dependency)

```sh
python -m pip install -r scanner_service/requirements.lock -r scanner_service/requirements.bulk.txt
python -m scanner_service.bulk_review .scanner-private/tejhq/bulk/REVISION/manifest.json \
  --capture-dir .scanner-private/tejhq --master .scanner-private/tejhq/nse-master.csv \
  --output .scanner-private/tejhq/bulk-review.json \
  --metadata-output .scanner-private/tejhq/raw-view-metadata.json \
  --csv-output .scanner-private/tejhq/raw-view-candles.csv
```

This command is offline: it does not fetch data, spend API quota or enable signals. Its manifest records each provider path, private local path, byte size, SHA-256, published LFS SHA-256 and one 40-character repository revision. Local files must stay inside that manifest’s snapshot directory. Keep all artifacts private. Budgets are 25 MB/file, 100 MB/snapshot, five million rows/year and at most 366 daily rows per selected symbol/year. Invalid sizes/hashes/paths, duplicates, inconsistent revisions or missing annual files stop review.

The reader disables inferred Hive partition columns because these files already contain a `year` field. It uses the API’s explicit requested `from`/`to`, rather than the first/last returned candle, so shared missing first/last sessions are detectable. Full-market date observations supply the expected dates for the selected price comparisons; they are not an independent official holiday calendar. Action-interface equality does not certify action publication timing. Any future timestamp fields are preserved at full precision for review and never auto-approved.

If comparisons and stable identity checks pass, emitted metadata is **raw-view only**: both historical-universe and corporate-action completeness remain false, actions are not attached, sectors are unclassified and no index series is invented. An identity’s `known_on` is its earlier dated observation in the source history (before the reviewed period), not an announcement timestamp. Price viewing is permitted without changing the mathematical engine. Normal importer/scan commands expose raw candles through the existing authenticated pages; quality gates still withhold pivots, indicators, transitions and backtests.

The user explicitly selected **strict verification**. Do not substitute ex-date close for missing announcement/publication timing. The current pipeline also derives some split events from unexplained price steps; those are identified in its `raw_subject` provenance and must not be silently accepted as exchange-announced events. None of those inferred split rows occurs in the four reviewed stocks during this period.
