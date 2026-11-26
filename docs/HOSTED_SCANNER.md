# Hosted-only scanner: deployment preparation

The owner selected hosted-only operation, with no computer kept running and no paid services. The existing Vercel website serves the scanner UI and a protected proxy. Its private Python/PostgreSQL backend is **not deployed**. These changes prepare job execution; they do not provision an account, database, runner, cron or market-data licence.

## Execution model

The default `SCANNER_JOB_MODE=embedded` retains the existing persistent-service behavior. A single process owns its one background thread and marks its interrupted jobs failed on restart. Do not deploy that process model unchanged into short-lived function instances.

With `SCANNER_JOB_MODE=external`, authenticated API requests validate and persist jobs and return their immutable ID; no thread starts. API cold starts leave queued and running work intact. PostgreSQL serializes queue admission to two active jobs and uses row locks/conditional updates so concurrent batch workers claim different queued runs. No schema migration or mathematical-engine change is required.

A separately scheduled worker uses the same private PostgreSQL database:

```sh
SCANNER_JOB_MODE=external python -m scanner_service.worker --max-jobs 2 --start-budget-seconds 300
```

Supply `SCANNER_DATABASE_URL` or the existing database variables through the host's secret settings. Never put values in Git, browser variables, logs or chat. The worker reads already imported immutable inputs and stores gated research results. It makes **zero provider requests** and is not the data importer or scheduler. Existing permitted-data import/update commands must run separately before research jobs.

The start budget stops the worker from beginning another job after its deadline; it does not interrupt a calculation already running. A hosting platform's hard timeout still applies. Benchmark real workloads before selecting limits. This has not been validated at all-exchange scale or against any hosting provider's current free-plan capacity.

The scanner recognizes an external queue response and stops waiting without background polling. Record the returned ID. **Check research job** makes one authenticated read and loads a completed scan/backtest; it does not requeue it. After reloading, reconnect, enter the recorded ID and check again. Queued jobs require an actually running scheduler/worker, not merely this API setting.

## Interrupted jobs

A crashed batch worker leaves its claimed run `running`. It is never silently replayed or declared successful. Confirm the old worker has stopped before explicit recovery:

```sh
SCANNER_JOB_MODE=external python -m scanner_service.worker --fail-interrupted RUN_UUID
```

Only a running run can be failed this way; queued, completed and already failed records are untouched. Submit a new immutable run afterward. This is operator recovery, not automatic exactly-once execution. Never mix embedded API instances with external workers on one database: an embedded service owns process-local recovery and could cancel another worker's jobs.

## Remaining hosted deployment requirements

| Component | Current status |
| --- | --- |
| Vercel frontend and same-origin bearer-token bridge | Existing deployment; private service URL unconfigured |
| Short-lived API execution model | External queue mode implemented/tested; provider deployment pending |
| Persistent private PostgreSQL | Available only in development; no hosted account/connection supplied |
| Scheduled EOD import and batch worker | No hosted runner or schedule enabled; free-plan terms/quotas need verification |
| Verified action publication/factors and Nifty history/membership | Still missing; signals/backtests remain withheld |
| Historical all-equity universe/delistings and capacity | Not established by the four-stock raw sample |

Official Vercel documentation and Neon pricing requests were denied by the environment's network policy. A configuration draft adds only `vercel.com` and `neon.com` for research, preserving existing grants. Saving the draft does not apply access or prove free-plan suitability. No free provider is selected or provisioned yet; no new charge, account or automatic paid fallback was activated.

Hosted storage necessarily sends private research data to the selected host/database. Hosting consent does not grant data redistribution rights. Provider terms, retention, privacy, connection limits, storage/compute quotas, job duration and scheduler availability must be checked before setup. No perpetual-free or full-universe capacity claim is made.

## Validation

PostgreSQL tests cover authenticated queueing, cold-start durability, distinct concurrent claims, concurrent queue-cap enforcement, one-time consumption, bounded batch starts, malformed-job isolation, interruption recovery and existing unverified-signal/backtest gates. The browser audit uses synthetic fixtures and checks no automatic polling, one-request status checks and reconnect/resume without duplicate calculations:

```sh
SCANNER_TEST_DATABASE_URL=PRIVATE_DISPOSABLE_TEST_DATABASE python -m unittest scanner_service.tests.test_worker -v
npm run build
npm run test:scanner:worker
```

Do not point test fixtures at an imported personal database. Core calculation files and published demo provenance remain unchanged.

Executed checks: 70 backend tests passed with the disposable PostgreSQL fixture (no skipped PostgreSQL cases), three additional SQLite queue/recovery cases passed, and all 99 Node tests passed. TypeScript, production build, dashboard browser audit, workspace/review audits and the new external-worker browser audit passed. These checks validate job handling and preserved gates, not hosted operation or real-market performance.
