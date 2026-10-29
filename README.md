# Tickr

An Indian stock dashboard inspired by CoinMarketCap, built with React, Vite, and Express.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci --cache /tmp/tickr-npm-cache
npm run dev
```

Vite runs on port 5173 and proxies `/api` to Express on port 3001. For production: `npm run build`, then `npm start` (port 3001, or `PORT`). Run `npm test` for provider parsing tests.

## Data

The initial view is explicitly labelled sample data. All sample prices, index values, market caps, volumes, percentages, and chart lines are illustrative, not current financial information.

Select **Free market data** to fetch the 12 curated NSE stock quotes through the backend. This uses Yahoo Finance's unofficial chart endpoint, with no API key. It has no availability guarantee and is not a licensed real-time exchange feed. Check the provider's terms before public or commercial use. Quotes show provider timestamps in details, are cached for 60 seconds, and can be delayed. Failed quotes display unavailable values; sample quotes are never substituted. Daily changes use the previous available daily close. Live market caps are intentionally omitted. Index summary cards remain explicitly illustrative in both modes.

Watchlists are saved in localStorage on this browser. There are no accounts, order placement, portfolio integrations, or investment recommendations. Network access to query1.finance.yahoo.com is required for quotes; no credentials are needed. Google Fonts is optional; system fonts are the fallback.

## Scope

Search, sector filters, gainers/losers, sortable quote columns, persistent watchlist, responsive stock table, and stock detail charts. Fundamentals, news, all exchange listings, and licensed streaming data are future work.

## Deploy to Netlify

For a GitHub-connected Netlify site, use `npm run build` as the build command and `dist` as the publish directory. These defaults are included in `netlify.toml`. Do not publish the source directory: its `index.html` references JSX that requires compilation.

For Netlify Drop, upload the contents of the generated `dist` folder (the `index.html` and `assets` folder together), or extract the provided `tickr-website.zip` and upload that folder. This static deployment supports sample mode only; the Express quote API needs separate hosting. A missing API does not prevent sample mode from loading.
