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

The separate **Sample data** mode still has 12 illustrative stocks. Its prices, market caps, volumes, changes, financial ratios, growth metrics and charts are fictional. Summary index and market-breadth cards are explicitly illustrative in both modes. No sample data is ever substituted into market mode.

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


## Heatmap time periods

The heatmap offers **24 hours**, **1 week**, and **1 month**. Changing periods updates tile colours, stock returns, weighted sector/industry returns, advancing/declining/unchanged counts, the inspector, category cards and the legend together. The selection is retained when changing exchange, grouping, stock limits or drilling into a category. Pending responses cannot repaint a different selected period.

- **24 hours** (`period=24h`, default) uses the provider's `change` field: daily change from the previous trading close, **not a rolling 24-hour return**. Weekends and exchange holidays can leave the last trading session's value displayed.
- **1 week** (`period=1w`) uses the provider's `Perf.W` weekly performance field.
- **1 month** (`period=1m`) uses the provider's `Perf.1M` monthly performance field.

Weekly/monthly values follow the provider's trading-session lookbacks; they are not computed by multiplying daily changes. The field mappings were checked against the public TradingView-Screener field reference. Values are retained as returned. Returns with no supplied value remain unavailable and grey, never replaced by daily data. If every return for a selected period is missing, the panel explicitly explains that absence.

The colour scale saturates at ±3% for daily, ±5% for weekly, and ±10% for monthly returns, with a matching visible legend. Tile areas always reflect the current known market caps. Weighted group performance is a descriptive snapshot using current weights, not a reconstructed historical sector-index return.

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
