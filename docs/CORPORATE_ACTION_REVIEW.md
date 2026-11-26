# Strict corporate-action review

The scanner currently withholds real-source signals and backtests. Matching raw candles across two interfaces from one provider does not verify action adjustments, historical publication timing or complete historical coverage.

## Official-source policy check: 26 November 2026

The NSE homepage links to [Terms of Use](https://www.nseindia.in/static/nse-terms-of-use), updated 29 October 2025. The previously tried `/terms-of-use` path returns 404; this is a path issue, not a missing domain grant. The new domain is reachable in environment revision 25.

The terms state: “User is prohibited to conduct any systematic or automated data collection activities (including scraping, data mining, data extraction and data harvesting) on or in relation to our Website / Mobile Application.” No announcement scraper or automated exchange-price comparison was run.

The [Copyright policy](https://www.nseindia.in/static/nse-copyright), updated 21 October 2025, permits viewing, printing and downloading content for personal, non-commercial or educational purposes, with attribution and other conditions. This does not establish permission for automated collection or every proposed downstream use. The terms also restrict gaming, virtual trading and simulation uses; permission for the proposed historical backtesting remains unresolved. Do not treat downloadable files as blanket permission for the scanner.

Private copies of both policy pages and their SHA-256 manifest are retained under `.scanner-private/tejhq/official-policy-review/`. No exchange content is included in this repository.

## Evidence needed before approval

For each action in a permitted, explicitly bounded stock/date scope, retain a private review record containing:

| Evidence | Required check |
| --- | --- |
| Security | Exchange, listing ID, symbol and ISIN at the event date; resolve stale ISINs explicitly. |
| Original notice | Permitted source URL/document, unmodified local copy and SHA-256; retain amendments and cancellations. |
| Historical availability | Original publication/broadcast date and time, timezone and evidence location in the source. A download timestamp, record date or ex-date is insufficient. |
| Effective session | Verify the ex-date against the reviewed trading calendar. |
| Action economics | Verify split/bonus ratios or dividend amount and the adjustment-factor convention, including units and rounding. |
| Decision | Reviewer, review date, evidence references and unresolved discrepancies. Missing evidence keeps the action unapproved. |

The import schema uses a session-level `known_on` date. Preserve the original publication timestamp in the private evidence record and map it conservatively to when an end-of-day calculation could actually use it. A date-only notice on the effective session does not prove availability before that session's calculation. Do not invent a time or silently use ex-date close.

Only supported split, bonus and cash-dividend events can enter the current action model. Rights issues, mergers, demergers or other unsupported events require explicit handling before completeness can be asserted. An AGM notice is not an adjustment.

Completeness is a separate review: approving one event does not prove all events were found. Keep `corporate_actions_complete` false until the full declared stock/date scope, identity transitions and unsupported events have been reconciled. Four surviving stocks also do not establish `universe_history_complete`; real backtesting still requires historical listings, delistings and terminal-event handling.

## Current decision

No action has been promoted by this policy check. No publication date, factor, benchmark or performance result was assumed. Raw-only private charts remain available; the public website remains the labelled synthetic demo. The next useful input is permitted original action evidence with historical publication timing, or a source whose terms expressly allow the required collection and research use at zero cost.

## Review screen

Open `/scanner.html` → **Data quality & review**. The screen shows the current input's action/universe attestations, reported stock coverage, missing benchmark roles and searchable stock-level data-quality messages. These are source reports, not certification. Private checks need a connected dataset; the demo is explicitly synthetic.

Corporate-action drafts record listing ID, action type, effective date, original publication timestamp with timezone, notice URL, document SHA-256, reviewer, review state and evidence notes. You can hash a notice locally (maximum 20 MB); its bytes are not uploaded. The hash identifies a file and does not establish truth or publication timing. Review source documents and adjustment economics separately.

Drafts live only in browser memory, survive section navigation, and are cleared on reload or source/dataset change. Export JSON to retain them privately. Imports append up to 100 drafts, accept at most 3 MB, validate fields, and require the exact export dataset scope. A demo export cannot be imported into a private dataset. Document URLs are displayed as text and are not fetched. No browser storage, provider call or server upload is used for the review workflow.

“Review recorded” requires evidence fields but is **not approval**. No record or import can change the immutable bundle, completeness flags, signal gate or backtest eligibility. Promotion remains a separate verified historical-data import; the screen does not automate discovery or establish scope completeness. To correct a draft, Edit moves it back to the form; save it again before exporting.

Validation: `npm run build`, `npm run typecheck:scanner`, and `npm run test:scanner:review` (run after building). The browser audit exercises scoped import/export, rejected unsafe/unknown fields, timezone/date requirements, local hashing, tab navigation, reload privacy, missing private-input checks and mobile layout using synthetic fixtures.
