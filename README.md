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

**Free market data** is now the default. `/api/stocks` retrieves NSE and BSE stock listings available through TradingView's public India scanner. There is no fixed 12-stock allowlist in market mode. Coverage depends on the provider; this is not a certified exchange master list. Companies listed on both exchanges appear separately with exchange-qualified IDs (for example `NSE:RELIANCE` and `BSE:RELIANCE`).

The directory contains provider-reported prices, daily changes, volume, sectors, and market caps in INR. Missing values remain missing. The complete snapshot is checked against the provider's reported total before it can be used for ranking; an incomplete result produces an error rather than a misleading global ranking. Warm function instances cache the snapshot for 15 minutes, share in-flight loads, and return only the requested page. Cold instances may refetch it.

Search, watchlists, gainers/losers, exchange filters, sector categories, and market-cap bands all operate across the returned directory. Sorting occurs **before** pagination. Default sorting is market cap descending; users can toggle ascending, with missing values last in either direction. Page sizes are 25, 50, or 100 listings.

Market-cap bands are explicit value ranges, **not official SEBI large/mid/small-cap classifications**:

- ₹1 lakh crore or more
- ₹20,000 crore to under ₹1 lakh crore
- ₹5,000 crore to under ₹20,000 crore
- Under ₹5,000 crore
- Market cap unavailable

Directory timestamps indicate when this server fetched the snapshot, not the exact exchange quote time. Prices may be delayed. The interface preserves this distinction.

## Charts and sample data

Opening a stock makes one on-demand request to `/api/quote/NSE:RELIANCE` (or its BSE equivalent) for a one-month Yahoo Finance chart. Legacy `/api/quote/RELIANCE` requests continue to use NSE. Daily price changes on this endpoint compare the previous available daily close. Responses include the provider's quote timestamp when supplied. Successful chart requests are cached for 60 seconds. Missing histories show an error, not a synthetic chart.

The separate **Sample data** mode still has 12 illustrative stocks. Its prices, market caps, volumes, changes and charts are fictional. Summary index and market-breadth cards are explicitly illustrative in both modes. No sample data is ever substituted into market mode.

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
