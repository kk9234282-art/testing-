# Tickr

A CoinMarketCap-inspired Indian stock dashboard built with React, Vite, and Node.js serverless functions.

## Run locally

Requires Node.js 20.19+ or 22.12+ (validated on Node 24).

```sh
npm ci --cache /tmp/tickr-npm-cache
npm run dev
```

Vite runs on port 5173 and proxies `/api` to Express on port 3001. For a production build: `npm run build`, then `npm start` (port 3001, or `PORT`). Run `npm test` for directory, filtering, normalization, and API tests.

## Stock directory and categories

**Free market data** is now the default. `/api/stocks` retrieves NSE and BSE stock listings available through TradingView's public India scanner. There is no fixed 12-stock allowlist in market mode. Coverage depends on the provider; this is not a certified exchange master list. Matched NSE/BSE listings appear once with both exchange labels, retaining exchange-qualified IDs for lookup and quote routing.

The directory contains provider-reported prices, daily changes, volume, sectors, and market caps in INR. Missing values remain missing. The complete snapshot is checked against the provider's reported total before it can be used for ranking; an incomplete result produces an error rather than a misleading global ranking. Warm function instances cache the snapshot for 15 minutes, share in-flight loads, and return only the requested page. Cold instances may refetch it.

Search, watchlists, gainers/losers, exchange filters, sector categories, and market-cap bands all operate across the returned directory. Sorting occurs **before** pagination. Default sorting is market cap descending; users can toggle ascending, with missing values last in either direction. Page sizes are 25, 50, or 100 listings.

Market-cap bands are explicit value ranges, **not official SEBI large/mid/small-cap classifications**:

- ₹1 lakh crore or more
- ₹20,000 crore to under ₹1 lakh crore
- ₹5,000 crore to under ₹20,000 crore
- Under ₹5,000 crore
- Market cap unavailable

Directory timestamps indicate when this server fetched the snapshot, not the exact exchange quote time. Prices may be delayed. The interface preserves this distinction.

## Sector heatmap

Use **Heatmap** in the navigation or the panel above the stock table. The default **Industries** view (or optional **Sectors** view) sizes tiles by the sum of known positive market caps and colours each sector by its market-cap-weighted return for the selected period. Click a sector tile (or focus it and press Enter) to explore its stocks. Click a stock tile to open the existing price chart, financial details, watchlist and comparison controls.

The heatmap defaults to **NSE**, with BSE and combined NSE + BSE options. Combined exchange results count matched dual listings once, preferring NSE quotes. Sector and exchange controls apply to the heatmap independently of the table screener. Table pagination does not reload or restrict the map. A stock view shows the largest 100 or 250 eligible listings; the caption discloses the displayed count. Sector summaries and breadth counters always use all matching listings in the directory snapshot, not just displayed stock tiles.

For each sector, the selected-period return is `sum(marketCap × periodReturn) / sum(marketCap)` over listings with both a positive, finite current market cap and a finite return for that period. Missing period returns are excluded from that denominator, not replaced by zero. Tile area still includes all known positive caps. The inspector discloses the share of known cap with usable daily changes. This is a descriptive weighted snapshot, not an official sector index return.

Stocks without positive market caps cannot form proportional tiles; their count is disclosed. Known-cap stocks without daily changes are grey, distinct from genuinely unchanged stocks. Advancing, declining, unchanged and missing-change counts are based on all matching listings, including listings without usable caps. Hover or focus a tile to inspect its name, daily change and market cap. The map resizes for mobile screens, supports keyboard activation, and includes explicit loading, empty, error and retry states.

`GET /api/heatmap?exchange=NSE&sector=Technology&limit=100` returns full-snapshot sector summaries and the largest eligible stock tiles, with the fetch timestamp. It uses the existing directory loader and its 15-minute in-memory cache; no per-tile upstream requests are made. Local Express routes share the same snapshot cache. Separate Vercel function instances can each fetch their own cached snapshot, so this is not a globally shared cache or a real-time feed. Sample mode uses only clearly labelled illustrative data. No new provider, API key, or account is required.

## Compare stocks and advanced screener

Use the **Compare** button beside a listing to select 2–4 stocks, including selections from different pages or search results. The tray opens a side-by-side table of prices, market caps, sectors, and seven financial metrics. Comparison requests fetch the selected exchange-qualified IDs from the full directory; current search and page filters do not restrict them. Both exchange labels are shown for matched dual listings. Closing with Escape restores keyboard focus, and removing the last selection closes the panel. Changing data modes clears selections so sample financials cannot be compared with provider values.

The **Advanced screener** supports independent minimum/maximum bounds for:

| Metric | Provider field | Unit / reporting period |
| --- | --- | --- |
| P/E | `price_earnings_ttm` | Ratio, TTM |
| P/B | `price_book_fq` | Ratio, most recent quarter |
| Revenue growth | `total_revenue_yoy_growth_ttm` | %, TTM year over year |
| Diluted EPS growth | `earnings_per_share_diluted_yoy_growth_ttm` | %, TTM year over year |
| Return on equity | `return_on_equity` | %, TTM |
| Debt/equity | `debt_to_equity` | Ratio, most recent quarter |
| Dividend yield | `dividends_yield_current` | %, current provider value |

Fields, units, and reporting periods were checked against the [TradingView-Screener field reference](https://shner-elmo.github.io/TradingView-Screener/fields/stocks.html). This documents the request schema, not availability for every Indian stock. Values are not estimated or rescaled. Provider coverage is returned as `fundamentalCoverage` per metric.

Edit the ranges, then press **Apply filters**. Three editable templates populate growth, ROE/debt, or dividend ranges; they do not execute until Apply is pressed. Invalid or inverted ranges are rejected both in the UI and by the API. Filters combine with sectors, exchanges, and watchlists, and run before pagination. The results table adds the financial columns being filtered or sorted. All seven financials are also available in stock details. Use **Reset screener** to remove financial bounds or **Clear filters** to reset all directory filters.

Missing metrics display as **Not available**, never zero. An active financial range excludes stocks missing that metric; otherwise those listings remain in the directory. P/E comparisons label non-positive P/E as **Not meaningful**, and P/E filters require positive values. Sector differences, reporting periods, negative equity, and EPS growth base effects should be considered when comparing ratios.

Example API requests:

```text
/api/stocks?peMax=25&roeMin=15&debtEquityMax=1&pageSize=25
/api/stocks?sort=revenueGrowth&direction=desc
/api/stocks?ids=NSE:RELIANCE,NSE:TCS&pageSize=4
```

Optional financial columns are requested in the existing directory fetch, avoiding per-stock fundamental requests. If the provider rejects optional fields with HTTP 400/422, the loader first retries with core fields plus industry, then core fields alone if necessary, so browsing still works. In that case all financial values remain unavailable and financial filters produce no matches. Rate limits do not trigger this retry. Browser checks exercised the screener, 4-stock limit, cross-page comparisons, missing values, validation, mobile layouts, error states and sample/market separation with controlled provider responses. Live fundamental coverage remains unverified from this restricted environment.

Comparison selections and screener drafts are held in browser memory and reset on reload; watchlists continue to persist locally. No account, broker credentials, portfolio holdings or additional paid service is required.

## Charts and sample data

Opening a stock makes one on-demand request to `/api/quote/NSE:RELIANCE` (or its BSE equivalent) for a one-month Yahoo Finance chart. Legacy `/api/quote/RELIANCE` requests continue to use NSE. Daily price changes on this endpoint compare the previous available daily close. Responses include the provider's quote timestamp when supplied. Successful chart requests are cached for 60 seconds. Missing histories show an error, not a synthetic chart.

The separate **Sample data** mode still has 12 illustrative stocks. Its prices, market caps, volumes, changes, financial ratios, growth metrics and charts are fictional. Summary cards are illustrative only in Sample data mode; Free market data uses the index feed and full directory breadth described below. No sample data is ever substituted into market mode.

Both data services are unofficial, keyless public endpoints without availability or real-time guarantees. Check provider terms and data licensing before public/commercial use. The development environment blocked the scanner domain and Yahoo returned rate limiting during setup, so local tests use controlled provider responses; these are not proof of external provider availability. No credentials are required. Servers need network access to `scanner.tradingview.com` and `query1.finance.yahoo.com`. Google Fonts is optional.

Watchlists are stored in localStorage and include the exchange. Older symbol-only watchlists remain readable. No accounts, orders, portfolio integrations, or investment recommendations are included.

## Deploy on Vercel

Import this GitHub repository with the project root set to the repository root. `vercel.json` selects Vite, builds with `npm run build`, and serves `dist`. Vercel deploys the `api` directory as Node.js functions; no separate Express service or API key is needed.

After deployment:

1. Open `/api/health`; expect `{"ok":true}` (this confirms the app API, not upstream data availability).
2. Open `/api/stocks?pageSize=25`; expect `stocks`, `total`, `universeTotal`, `sectors`, `categories`, and `fetchedAt`. Confirm the count exceeds the old sample list and the first page is sorted by market cap.
3. Search a company outside the original sample list, change sectors/exchanges/cap ranges, toggle the sort direction, and move to the next page.
4. Open a stock to load its chart. `/api/quote/NSE:RELIANCE` should return a quote and timestamp, or a truthful 502 if the provider is unavailable.

`/api/stocks` has a 60-second function duration to allow full-directory retrieval. Request failures are not cached as successful data. A 502 indicates an upstream failure; the frontend offers an explicit switch to sample mode.

## Deploy a static sample on Netlify

`netlify.toml` configures `npm run build` and the `dist` publish directory. Netlify Drop can host the built `index.html` and `assets` folder together. A static-only deployment does not execute the API functions: select Sample data. Use Vercel for the full directory and quote API.

## Detailed industries and category coverage

The feed's broad `sector` field combines businesses such as banks and insurers into one group. Tickr now also requests `industry`, whose public field reference enumerates 130 industry labels. Only labels attached to listings in the returned snapshot are presented; this is not a promise that all 130 contain Indian listings.

The heatmap defaults to **Detailed industries**. Switch **Heatmap grouping** to **Broad sectors** for the previous view. Its category dropdown and **Browse all … categories** directory expose every matching category, including groups with tiny tiles or no usable market cap. Groups without market caps remain in the directory even though they cannot be drawn proportionally. NSE remains the default exchange; choose NSE + BSE to include categories represented only on BSE.

Missing industry classifications are retained under an explicit `Broad sector (industry unavailable)` group. No industry is guessed from a company name. **View this category in the stock table** opens the matching industry or sector, preserving the heatmap exchange and clearing conflicting screener filters. The stock table has a separate **Filter industry** dropdown that combines with sector, exchange, search and financial ranges. Clearing or changing a sector/exchange clears the dependent industry filter.

`/api/heatmap?groupBy=industry&group=Major%20Banks&exchange=NSE` selects a provider industry label. The response includes `availableGroups`, `unclassifiedIndustries` and the matching table `selectedFilter`. The legacy sector-only parameters remain supported. `/api/stocks?industry=Major%20Banks` filters the full directory, before pagination. An `industry=__missing__` filter finds listings without an industry classification.

If optional financial fields are rejected, the loader first retries with core fields plus industry, then retries core fields alone only if industry is also unsupported. Availability depends on the provider. Classification, fallback, weighting and filter tests use controlled fixtures; live industry coverage could not be checked because the runtime network policy does not allow the scanner domain.


## Heatmap names

**Names list** opens a searchable list of full category names or the stocks in the current map. Categories without usable market caps remain accessible in the category list. Stock lists cover the selected largest 100/250 companies; choose a category to explore its constituents. Hover or focus a tile for its full name and values. Name searching runs locally without additional API calls.

## Heatmap time periods

The heatmap offers **24 hours**, **1 week**, **1 month**, and **1 year**. Changing periods updates tile colours, stock returns, weighted sector/industry returns, advancing/declining/unchanged counts, the inspector, category cards and the legend together. The selection is retained when changing exchange, grouping, stock limits or drilling into a category. Pending responses cannot repaint a different selected period.

- **24 hours** (`period=24h`, default) uses the provider's `change` field: daily change from the previous trading close, **not a rolling 24-hour return**. Weekends and exchange holidays can leave the last trading session's value displayed.
- **1 week** (`period=1w`) uses the provider's `Perf.W` weekly performance field.
- **1 month** (`period=1m`) uses the provider's `Perf.1M` monthly performance field.
- **1 year** (`period=1y`) uses the provider's `Perf.Y` yearly performance field, not `Perf.YTD` or an annualized multi-year return.

Weekly/monthly values follow the provider's trading-session lookbacks; they are not computed by multiplying daily changes. The field mappings were checked against the public TradingView-Screener field reference. Values are retained as returned. Returns with no supplied value remain unavailable and grey, never replaced by daily data. If every return for a selected period is missing, the panel explicitly explains that absence.

The colour scale saturates at ±3% for daily, ±5% for weekly, and ±10% for monthly returns, and ±30% for yearly returns, with a matching visible legend. Tile areas always reflect the current known market caps. Weighted group performance is a descriptive snapshot using current weights, not a reconstructed historical sector-index return.

`/api/heatmap?period=1w&groupBy=industry&exchange=NSE` returns the selected period in metadata. Stock tile responses include `heatmapChange` and `heatmapPeriod` while retaining the original daily `change` for stock details. A weekly/monthly selection is labelled separately when opening a stock. The underlying stock table and comparison daily-change fields remain daily.

Weekly and monthly fields are requested in the existing cached directory fetch. If the provider rejects these optional fields, the loader first removes only performance fields and retains financial/industry data; subsequent optional-field fallbacks still protect basic browsing. No per-stock history fetches or additional API keys are required. Sample mode contains distinct, explicitly illustrative day/week/month values. Automated tests and browser checks use controlled data; live performance-field availability remains unverified from the restricted workspace.

## Search on GPT

Open a company's existing stock-details dialog and click **Search on GPT ↗**. The action generates the complete supplied business-research prompt using that selected company's name, exchange-qualified ticker, and available public listing identifiers (including ISIN when present). The same generator works for every listing; there is no separate company database or per-company prompt.

This uses the **clipboard fallback**, not an automatic pre-fill URL: the click copies the full prompt and follows a native `target="_blank"` link to `https://chatgpt.com/`, with `noopener noreferrer`. Paste into ChatGPT, review, and send. No prompt is submitted automatically or placed in a URL. No OpenAI API dependency, API key, or paid integration is required. ChatGPT may require its own sign-in.

If clipboard access fails, the dialog displays the full read-only prompt with Select prompt, Copy again, and Open ChatGPT controls. Company identity is limited to public name, ticker, exchange, listing ID, ISIN, sector and industry; quotes, holdings and credentials are not included. Missing names or symbols use the remaining identity with an explicit verification note. Without either a name or ticker/listing identifier, the action is disabled. Clipboard support is best on HTTPS or localhost; browser permissions still apply.

Implementation: `shared/company-research.js` holds the reusable prompt generator; `src/SearchOnGPT.jsx` implements the scoped action and copy recovery; `src/main.jsx` mounts it only in company details. Styles are scoped in `src/style.css`. Stock fetching, routing, navigation and existing actions are unchanged.

To test after deployment, search for Adani Ports, open its details, click Search on GPT, and paste into ChatGPT. Confirm the company name and NSE:ADANIPORTS appear and all 12 research sections are present. Repeat with a different NSE/BSE listing. `npm test` checks exact prompt-template integrity, dynamic identity, missing fields and literal characters. Automated browser checks exercised Adani Ports first with the real browser clipboard, then other NSE/BSE companies, tab URL/opener safety, copy failures and retries, mobile layout, watchlists and comparisons. The ChatGPT destination was intercepted during these tests; no research prompt was auto-submitted to the external service.

## One row per matched NSE/BSE company

Matched dual listings now appear once in the stock directory, comparison and combined heatmaps, with an **NSE + BSE** label. In the combined view, the row uses the NSE listing's prices, returns, market cap and financials. BSE-only companies remain visible. Choosing an explicit exchange selects that exchange's listing and prices while retaining the combined exchange label. Detail panels identify the actual quote source.

Matching uses a shared valid ISIN when present in the input data. Otherwise, a conservative normalized legal-name match is used only for an unambiguous NSE/BSE pair, allowing capitalization, punctuation and terminal Ltd/Limited differences. Conflicting ISINs, multiple same-exchange candidates, differing share-class names and ambiguous matches remain separate. The current core provider request does not supply ISIN, so live matching normally relies on those conservative names. It is not fuzzy company-name matching and cannot guarantee every differently named pair will merge.

Grouping occurs before search, financial filtering, sorting and pagination. Both listing IDs, ticker symbols and names remain searchable. Existing BSE or NSE watchlist entries resolve to the merged row, and comparison selections recognize either listing. Underlying listing metadata is retained, so exchange-specific chart/GPT research actions continue to use the actual selected quote identity. Market caps, volumes and percentage returns are never added or averaged between exchanges. Combined heatmaps count a matched issuer once, using the preferred listing's market cap and selected-period return.

The original raw listing count is available as `listingTotal`; directory `total`/`universeTotal` and heatmap count fields now count deduplicated company rows. Provider matches remain unverified against the live restricted feed; unit and browser tests use controlled dual-listing examples and ambiguous-identity cases.

## Regression and security checks

Run `npm test`, `npm run build`, `npm run test:browser`, and `npm audit` before a release. The browser suite starts the local production server and uses deterministic provider/ChatGPT fixtures; it does not require API keys or submit external research prompts. Install Chromium with `npx playwright install chromium` if no system Chromium is available. See [AUDIT.md](AUDIT.md) for the reviewed scope, fixes, actual results and unverified production/data-provider limitations.


The yearly field is requested with the existing directory snapshot. If `Perf.Y` is unsupported, only the yearly field is removed on the first fallback, preserving the older day/week/month views and fundamentals. Missing yearly values remain unavailable, never derived from daily/monthly changes. Sample mode includes explicitly illustrative one-year returns. The public field reference confirms `Perf.Y`; live provider coverage remains subject to the existing runtime restrictions.


## Stock-board time filters

The main stock board now offers **24 hours, 1 week, 1 month, and 1 year** independently of the heatmap. The selected-period percentage column, return sorting, Gainers and Losers use the matching provider return across the full deduplicated directory before pagination. Other filters combine with that period; changing periods resets the page. Latest prices, daily volume, stock-detail price changes and comparison daily changes remain daily/latest values. A stock opened from a non-daily board selection separately labels the selected-period return.

`/api/stocks?period=1y&sort=change&direction=desc` returns `boardChange`, `boardPeriod` and period metadata while retaining the original daily `change` field. Missing returns display as an em dash, stay last when sorting in either direction, and do not qualify as gainers or losers. Sample mode uses the existing explicitly illustrative period returns. All periods reuse the cached directory; no per-stock requests or additional API keys are introduced. As on the heatmap, 24 hours is change since the previous trading close, not a rolling 24-hour return.


## Index cards and market breadth

In **Free market data** mode, NIFTY 50, SENSEX and NIFTY BANK come from Yahoo Finance’s unofficial, no-key chart endpoint (`^NSEI`, `^BSESN`, `^NSEBANK`). `/api/indices` requests intraday 5-minute charts and caches the result, including failed individual indices, for 15 minutes per warm function instance. Concurrent requests share the pending fetch. The browser automatically refreshes every 15 minutes only during the regular weekday session (Mon–Fri, 9:15 AM–3:30 PM IST), and supports manual refresh. This is a free snapshot feed that may be delayed, not a guaranteed real-time stream. Each card shows the provider’s quote date/time in IST; the percentage compares the latest price with the previous session close. A missing previous close produces an unavailable return. Sparklines use only actual supplied intraday closes; they are omitted when insufficient data exists.

`/api/breadth` calculates daily advances, declines, unchanged and missing returns across the full cached NSE + BSE company directory, before table search, filters or pagination. Matched dual listings count once, preferring NSE quotes. The bar proportions include unchanged and unavailable returns; the caption shows coverage and the directory fetch time in IST. Fetch time describes retrieval of a possibly delayed snapshot, not a trade timestamp. This endpoint reuses the 15-minute directory loader; Vercel function instances can maintain separate caches. Breadth follows the same 15-minute, regular-market-hours browser schedule. Neither endpoint requires a key or account.

Failed indices remain individually unavailable without hiding successful indices; a failed breadth fetch shows unavailable counts. Market mode never substitutes sample prices, returns or chart lines. Sample mode makes no summary requests and clearly labels its illustrative index values and breadth from the sample companies.

Validation: unit tests cover quote identity/currency/timestamp validation, previous-close returns, incomplete history, failure caching/recovery, concurrent requests, route methods, snapshot failures and deduplicated breadth. Browser tests cover cards, negative returns, IST timestamps, failure/retry, sample isolation and mobile layout using controlled fixtures. A live Yahoo request from this workspace returned HTTP 429; successful current index values could not be verified here. Live scanner access remains subject to the existing environment restrictions.

On initial page load, summary data is requested once even outside market hours so the latest available snapshot can be displayed. Automatic requests stop outside the regular weekday session and resume during the next session. The index server retains its warm cached snapshot while closed; a cold function can fetch once to populate its cache. Manual refresh and page reload can request a snapshot, subject to the server cache. Holidays and special trading sessions are not tracked; the weekday schedule is explicitly shown in the UI. This is per-instance caching, not a shared persistent cache across all Vercel instances.

## Company charts, news, results and dividends

Company details now offer **Chart · News · Results · Dividends** tabs. The chart uses TradingView’s open-source **Lightweight Charts 5.0.9**, loaded only when the research panel opens. It includes daily candlesticks, a volume pane, crosshair OHLC/volume readings, drag/pinch/scroll navigation, fit-to-data, and 1M/3M/6M/1Y/5Y history ranges. A keyboard-accessible price table provides the same OHLC/volume values. Dividend markers use actual supplied historical ex-dividend dates. There are no drawing tools, technical indicators or TradingView embedded widgets in this version. Required attribution appears below/on the chart; license and NOTICE copies are in `licenses/`.

The **Use classic view** button restores the previous line chart without changing the table, heatmap, financial snapshot, watchlist or comparison. The browser remembers the preference when local storage is available. A build flag can disable the feature globally. The exact previous version is saved as `before-company-research-2026-11-25` (`2678b8e`). See [ROLLBACK.md](ROLLBACK.md) for all rollback options and the tested disabled-build command.

`GET /api/company/NSE%3ATCS?section=chart&range=1y` accepts NSE/BSE listing identities, one of `chart`, `news`, `results`, `dividends`, and chart ranges `1m`, `3m`, `6m`, `1y`, `5y`. Requests are made only for the active tab/range; Chart also loads news once for its markers. There is no automatic research polling. The existing quote route is used only in classic view. Prices/results/dividends use fixed Yahoo Finance HTTPS endpoints; news also uses fixed public RSS endpoints. No API key or account is required:

- **Chart:** unadjusted daily OHLC and optional volume; malformed candles are discarded. Missing volume is not zero. Cash-dividend events are reused for markers. The source is an unofficial feed, may be delayed, and is not a total-return series.
- **News:** headlines, publisher, date and safe HTTPS links to original articles from Yahoo Finance, Moneycontrol Business RSS, and Google News RSS. Yahoo requires an explicit ticker tag; RSS requires the company name or an eligible uppercase ticker in the headline. RSS matches can mention several companies and are not verified corporate announcements. No full article content, thumbnails or third-party scripts are embedded. A missing feed is not evidence of no company news.
- **Results:** fundamentals-timeseries quarterly revenue, net income and diluted EPS, joined by period end. Only INR, three-month figures are displayed; missing metrics remain unavailable. Revenue/net income are converted to ₹ crore. Period-end dates are not announcement dates. Consolidated/standalone scope must be checked against company filings. Upcoming earnings dates and earnings markers are unavailable in this source integration.
- **Dividends:** reported cash dividends for the past year, amount per share in INR and historical ex-dividend date. Record and payment dates are not supplied and remain unavailable; no future dividend promises are inferred.

Warm API instances cache charts/news for 15 minutes and results for six hours; failures are cached for 15 minutes to reduce repeated rate-limited requests. Chart and dividend tabs share the same one-year provider snapshot when applicable. Caches are bounded and concurrent identical work is coalesced; a maximum of six distinct company requests can be active per instance. Each news load queries up to three feeds in parallel; the Moneycontrol RSS response is shared across companies for 15 minutes. Separate Vercel instances have separate caches. Browser tab data is reused for up to 15 minutes; the Refresh control still respects server cache. Validation occurs before provider requests, and arbitrary provider URLs are never accepted. Sample mode uses explicitly fictional research examples and makes no research API calls.

Validation covers OHLC integrity, ticker/currency matching, ex-dates vs missing payment dates, safe/ticker-matched news links, quarterly period joins, losses/missing values, cache keys/coalescing/failure recovery, method/input checks and concurrency limits. Production-browser checks cover canvas rendering, timeframe changes, all tabs, text injection, errors/retries, sample isolation, mobile width, keyboard focus/Escape and classic-view restoration. A separate build smoke test verifies `VITE_COMPANY_RESEARCH=false`. Live chart, news and quarterly-result checks returned HTTP 429 in this workspace; successful live coverage for Indian companies remains unverified. Empty/error screens intentionally expose those limits rather than invent data.


## Historical news markers and local archive

Chart view now shows **N** markers for available news grouped by their actual IST publication date, alongside **D** dividend markers. Click an N marker, click a candle on that news date, or select an accessible date button below the chart to read headlines, publishers, timestamps and original article links. **News markers (N)** and **Dividend markers (D)** checkboxes hide/show each type without resetting the chart viewport. No news is moved onto an earlier candle: weekend/holiday dates, dates outside the selected range and days without usable OHLC remain in the News tab. Headlines published after market close may share the same day's marker; the UI explicitly warns of that timing.

`section=news` additionally accepts a bounded company `name`, sent by the UI from the stock directory. Yahoo's tagged headlines are combined with `https://www.moneycontrol.com/rss/business.xml` and `https://news.google.com/rss/search` using a company-specific query. RSS matching uses full company names (after removing a legal suffix) or conservative uppercase ticker tokens, not broad sector keywords. Publisher names and feed provenance are retained, safe URLs and publisher/headline pairs are deduplicated, tracking query parameters are removed, and each source reports available/unavailable status and matched counts. An available feed with zero matches is not the same as an unavailable feed. Partial results remain usable; if every feed fails the API returns 502 with per-source status. XML documents over 1 MB, entity/DOCTYPE declarations, malformed feeds, unsafe links and invalid publication dates are rejected. No arbitrary feed URLs are accepted.

Real headlines fetched while you use Chart/News are saved under `tickr-news-history-v1` in **this browser's local storage only**. The archive merges across visits and keeps up to 200 headlines per listing, 30 listings and 2,000 headlines overall, prioritizing the most recently opened listing and newest publication dates. Missing/blocked/quota-limited or corrupt storage does not break charting. Saved headlines remain visible when the next provider request fails; sample headlines are never stored in the real archive. Publication time and publisher remain attached to each story. This is not a complete multi-year news database or a continuously running collector: there is no collection while the app is closed, no cross-device sync, and clearing browser data removes the archive.

Validation: unit tests cover RSS identity matching, HTML/XML/entity rejection, missing feeds, partial-source recovery, shared RSS caching, cross-source deduplication, IST grouping, non-trading-day exclusion and local-history merging/bounds/storage failures. Browser tests cover accessible marker selection, headline escaping, both filters preserving the canvas, local archive writes, saved-news recovery during a feed outage, mobile layout and classic-view rollback. New RSS hosts are blocked by this workspace's network policy; their live availability remains unverified. Existing Yahoo live checks returned 429. Feed statuses surface these limitations without substituting invented news.

The version before news markers is saved as `before-news-markers-2026-11-25` (`1a51768`). The original pre-research baseline remains `before-company-research-2026-11-25` (`2678b8e`).

## News quality and repetition filters

Both the News tab and chart markers default to **Important news**. The rules look for a clear company headline subject and a company event: results, dividends, orders/contracts, corporate actions, management changes, regulatory/legal developments or operational disruptions. Tips, price-target predictions, promotions, routine price headlines and market roundups are excluded from this default view. **All news** restores all fetched/saved headlines while still grouping close duplicates. These are English headline heuristics, not fact checking, investment advice, or an independent publisher credibility rating; relevant stories may be missed. Nothing is deleted from the original local archive.

Similar headlines on the **same IST publication day** appear as one newest headline with an expandable **other sources / related headlines** list. Grouping uses normalized words and conservative similarity, with guards for differing numbers, financial units, event types, quarters, directions and publication days. Distinct developments are deliberately left separate when uncertain; grouping is not a complete semantic understanding of the articles. Every original publisher, timestamp and link remains accessible in its group. Stories on different dates are not moved to another chart day.

The **Publishers** picker applies before grouping, so excluded publishers never supply a group's main headline or alternate links. All publishers are selected by default; the selection and quality mode stay in sync between chart markers and the News tab within the current panel. Empty filters produce a clear message. Filtering/grouping run entirely in the browser, preserve the chart viewport, and make no additional API requests. The view settings do not change the raw local history or the existing classic-view/disabled-build rollback.

Validation includes important negative news, passing company mentions, price-tip/promotion exclusion, retained All news coverage, similar headline grouping, conflicting numbers/quarters/directions/units, publication-day boundaries, publisher selection and immutable source records. Browser checks cover grouped alternate links and text escaping, Important/All transitions, source selection/empty states, no new API requests during filtering and unchanged chart canvas. The pre-quality version is tagged `before-news-quality-2026-11-25` (`c3136ec`).

## Chart and news reading layout

Research mode opens in a wider, compact company dialog. Desktop puts the candle chart beside an **On this day** news reader; small screens stack the reader under the chart. The selected news date is highlighted on the chart and in a horizontally scrollable timeline. The latest available date in the current range is selected initially, and Previous/Next controls step through dates. Selecting an off-screen date from the timeline pans to that candle while keeping the current zoom span; changing quality, publisher, search or event-type filters does not recreate the chart. The Fit chart button remains an explicit reset.

News cards show a publisher monogram (no external image requests), publication time in IST, event category, article link and expandable alternate-source coverage. The News tab groups cards by publication day. **Search headlines or publishers** also matches grouped alternate headlines, and **All event types** can narrow coverage to Results, Dividends, Orders & contracts and the other existing event categories. These controls apply to the News tab and chart together, entirely in the browser with no extra API calls.

Source status, archive limits and detailed filtering/coverage notes are available under **Sources & coverage**. Delayed-data and sample labels remain visible even when that section is closed. Empty chart/news views offer clear recovery actions. Source fetching, quality rules, local archive storage and quote timestamps continue to use the existing implementation; the redesign does not create additional data coverage. Sample mode includes three explicitly fictional event dates to demonstrate the timeline and its navigation.

Checks include the production browser audit, headline escaping and grouped sources, text search/type filters without network requests, timeline navigation, side-by-side desktop vs stacked mobile layout, viewport widths 320/360/390/768/1024/1440, keyboard boundaries/Escape and classic-view restoration. The pre-redesign version is saved as `before-news-layout-2026-11-25` (`ada5738`).

## Names list: return ranking

The heatmap **Names list** defaults to **Highest return**, ranking all matching entries by their selected-period return, highest first. Positive, zero and negative returns stay visible; unavailable returns remain at the bottom with no numeric rank. Equal returns sort by name. Numbered ranks refer to the currently searched list. The ranking follows the 24-hour, one-week, one-month or one-year heatmap period. Industry/sector entries use market-cap-weighted category returns; stock entries use the selected-period stock return. **Market cap** restores the original market-cap ordering. Sorting is local, combines with name/symbol search and makes no additional API calls. Browser checks cover descending order, retained negative/missing returns, all periods, search and market-cap restoration.
