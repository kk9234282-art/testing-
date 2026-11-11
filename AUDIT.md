# Tickr correctness and security review

Review date: 11 November 2026 (Asia/Kolkata). Baseline: `b6dd3f6`.

This is a scoped code review and regression audit of the read-only dashboard, not a guarantee that the application is bug-free or immune to every attack.

## Results

| Check | Result |
| --- | --- |
| Production build | Passed |
| Node unit/integration suite | 55 passed, 0 failed |
| Repeatable production-browser suite | Passed in Chromium, desktop and mobile |
| Dependency advisory scan (`npm audit`, including development dependencies) | 0 known advisories at review time |
| Tracked-file credential-pattern scan | No matches; values were not printed |
| Express security headers and API method/input rejection | Verified with real local HTTP requests |
| Vercel security-header configuration | Verified to match Express policy; not observed live |
| Deployed Vercel application | Not verified: workspace egress proxy rejected the connection with CONNECT 403 |
| Live scanner/quote availability | Not established by fixture tests; existing restricted-network/free-provider limitations remain |

The browser suite starts the production server, checks real response headers, and then intercepts provider/API data and ChatGPT navigation for deterministic workflows. It uses the real browser clipboard for the GPT handoff. No research prompt is auto-submitted to ChatGPT. Unexpected browser errors and CSP violations fail the suite.

## Confirmed issues fixed

1. **BSE comparison removal:** A BSE-selected company could resolve to a preferred NSE row in comparison. The remove button then used the quote row's NSE ID instead of the selected BSE ID, leaving the selection stuck. The original selection ID is now preserved independently from quote identity. Covered by the browser regression.
2. **Company-dialog keyboard handling:** The custom overlay lacked native modal focus containment and Escape behavior. It now uses a native dialog with explicit focus restoration, background scroll locking and backdrop dismissal, retaining the existing styling. Escape, Shift+Tab containment, return focus and mobile bounds are tested.
3. **Stale response presentation:** Stock directory and chart snapshots now carry their request context. Data belonging to an older filter/source/company is not rendered under a new context while effects refresh. Slow superseded search responses are exercised in the browser.
4. **Conflicting quote identity:** The quote handler previously preferred an arbitrary `symbol` query value over the route's symbol. It now uses the actual path identity (or Express route parameter), with validation and safe encoding before a fixed HTTPS provider URL. Tests cover conflicting query/path symbols and malformed input.
5. **Repeated chart work:** Equivalent `TCS` and `NSE:TCS` requests now share a canonical cache and an in-flight request. Active distinct provider chart fetches are bounded to eight per warm instance; excess requests receive uncached HTTP 429 with Retry-After. Recovery is tested.
6. **Directory runtime bounds:** Individual timeouts could cumulatively exceed the Vercel function budget. Directory retrieval now has a 50-second total deadline in addition to individual request limits. Upstream batches use stable symbol sorting instead of price-sensitive market-cap order; user-facing sorting remains local and unchanged.
7. **Malformed chart data:** Invalid close arrays are rejected; nonnumeric prior closes and out-of-range timestamps cannot create bogus percentage values or formatting failures.
8. **API validation and method consistency:** Repeated/object inputs, control characters, oversized known fields, invalid exchanges/categories, and invalid pagination values are rejected before provider work. Read-only local routes now reach the same method guards as Vercel functions; health permits GET/HEAD.

## Security hardening

- A matching Express/Vercel policy sets Content-Security-Policy, X-Content-Type-Options, X-Frame-Options, Referrer-Policy and Permissions-Policy. Script execution and browser API connections are limited to the app origin. Fonts are limited to the existing Google Fonts hosts; inline styles remain necessary for React's treemap positions. Objects, framing and foreign form destinations are blocked. Clipboard writes remain available for Search on GPT.
- Express no longer advertises its framework via X-Powered-By.
- Malicious provider text resembling an image with an event handler is checked in both table and company dialog: it stays text, creates no image node and runs no JavaScript.
- Existing external research links retain noopener/noreferrer. Browser checks confirm ChatGPT opens in a new tab without an opener and that the copied prompt matches the selected company.
- `.env.*` files are now ignored alongside `.env`; an example file can still be committed. No API keys were added.

## Workflow coverage

The automated browser run covers directory pagination/search, sector/industry/exchange filters, screener bounds and presets, matched dual listings, legacy BSE watchlist aliases and toggling, BSE-selected comparison removal, company details and keyboard controls, ChatGPT clipboard handoff, daily/weekly/monthly heatmaps, missing returns, stale searches, chart/provider failure messages and retry, sample/market separation, mobile sizing, and disabled/corrupt localStorage. Unit tests additionally cover normalization, financial ranges, cap-proportional layout, conservative identity matching, unsupported optional fields, request deadlines, concurrency and request validation.

## Limits and residual risks

- The production domain and scanner are outside this workspace's applied allowlist. Local checks do not establish production deployment status, actual market-data correctness or current NSE/BSE coverage.
- The free unofficial feeds can be delayed, blocked, rate-limited or changed. Homepage index/breadth cards and Sample data remain explicitly illustrative.
- Dual-listing matching normally relies on conservative names because the core feed does not supply ISIN. Ambiguous/differently named cases can remain separate; distinct securities must not be force-merged.
- The app's public read-only endpoints remain unauthenticated. In-memory caches, deadlines and concurrency bounds are per instance, not distributed abuse protection. Hosting-level access protection/rate limits were not configured in this review.
- The credential scan is heuristic and limited to current tracked files, not a forensic scan of all history or external hosting settings. Dependency advisory results can change after the review date.

## Repeat the checks

```sh
npm ci --cache /tmp/tickr-npm-cache
npm test
npm run build
npm run test:browser
npm audit
```

The browser suite uses `/usr/bin/chromium` when available, or a Playwright-installed browser. On another machine, install the browser with `npx playwright install chromium` first, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing Chromium executable. Browser screenshots are written to ignored `audit-artifacts/`.
