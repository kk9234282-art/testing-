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
| Short-lived API execution model | External queue mode and standalone Vercel bundle implemented/tested; deployment pending |
| Persistent private PostgreSQL | Available only in development; no hosted account/connection supplied |
| Scheduled EOD import and batch worker | Protected daily endpoint and deployment cron prepared; no live schedule enabled |
| Verified action publication/factors and Nifty history/membership | Still missing; signals/backtests remain withheld |
| Historical all-equity universe/delistings and capacity | Not established by the four-stock raw sample |

Official Vercel and Neon pages became reachable at environment revision 45. Their free-plan limits are verified below. No hosted account, database or production backend has been provisioned; no new charge or automatic paid fallback was activated.

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


## Verified free-plan option — 26 November 2026

Official pages inspected and retained privately with SHA-256 hashes:

| Service | Verified allowance | Practical limit |
| --- | --- | --- |
| [Vercel Hobby](https://vercel.com/docs/plans/hobby) | Free; 4 active CPU-hours, 360 GB-hours provisioned memory and 1 million invocations/month | Shared with other projects/features under the account's applicable quota; usage can pause at limits |
| [Python functions](https://vercel.com/docs/functions/limitations) | Hobby: 300 seconds, 2 GB RAM / 1 vCPU; standard Python bundle up to 500 MB; default request body 4.5 MB | The app keeps browser imports at 3 MB; no paid larger-function/body option enabled |
| [Daily cron](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing) | Included on Hobby, once daily per cron, hour-level timing | Not an intraday scheduler; executions consume function allowance |
| [Neon Free](https://neon.com/pricing) | No card required; 1 GB database storage, 100 CU-hours/month/project, 5 GB public transfer/month/project; idle compute scales to zero after 5 minutes | Keep the **Free** plan. Paid plans, AI credits and optional services are unnecessary. This is not a full-universe capacity guarantee |

The prepared schedule is `0 2 * * *` (02:00 UTC, 07:30 IST, with Hobby's hour-level execution window). Next-morning raw EOD capture fits the provider publication pattern better than intraday polling. Source freshness still comes from the provider, not the cron clock.

## One-time hosted setup

The owner has no Neon project yet. Creating one requires the owner's sign-in; no authenticated Neon/Vercel provisioning tool is connected here. Do not paste database URLs or tokens in chat.

1. Create one PostgreSQL project on [Neon Free](https://neon.com/pricing), without a card or upgrade. Retain scale-to-zero. Get its connection string privately.
2. Generate an isolated backend bundle from this checkout with `npm run scanner:hosted:prepare`. It writes a new directory under `.scanner-private/hosted-release` and refuses existing outputs; pass a different new path for later releases. It contains only allowlisted Python code, pinned requirements and deployment configuration, **no real data, environment files, database backup or credentials**. A private manifest records file hashes. The existing website's root Vercel configuration is unchanged.
3. Deploy that folder as a **separate backend project** in the existing personal Vercel Hobby account. For a one-time CLI setup, run `npx vercel --cwd PATH_TO_EXTRACTED_BACKEND`, sign in and create a new backend project; leave the existing frontend project alone. No computer needs to stay running afterward. Configure the variables below in that backend project's Vercel settings, then deploy Production with `npx vercel --cwd PATH_TO_EXTRACTED_BACKEND --prod`. Preview does not activate the production daily schedule.
4. On the existing frontend Vercel project, set the **server-only** `SCANNER_SERVICE_URL` to the backend's exact HTTPS origin and redeploy the frontend. Never put database URLs or tokens in `VITE_` variables. Backend updates require a new bundle/deployment; frontend Git pushes alone do not update this separate backend project.
5. Verify the backend health route, confirm unauthenticated dataset access returns 401, and open `/scanner.html` on the normal website. Choose Private imported history, enter the owner token, and Connect. No owner token is injected for public visitors.
6. Import the supplied private **raw-view-only** JSON via Data & methodology. It contains the provider-reviewed four-stock identity/calendar scope and 2,880 raw candles (2024-01-01 through 2026-11-25), with both completeness flags false and no action factors or index membership invented. The browser import is under 3 MB. Do not place the input JSON in the deployment bundle or public repository.
7. Queue a scan, record its ID, and check after the daily worker runs. The result remains raw-only. On Connect, the private source status also reports the last hosted batch day/state and processed-job count. No live private deployment or scheduled invocation has yet been verified.

Required backend variables:

| Variable | Value to supply privately |
| --- | --- |
| `SCANNER_DATABASE_URL` | Neon connection URL using `postgresql+psycopg://`, preserving the dashboard's actual credentials, host, database and TLS query options; `sslmode=require` or stronger is required |
| `SCANNER_ADMIN_TOKEN` | Random URL-safe token, 24–200 characters |
| `CRON_SECRET` | A **different** random URL-safe token, 24–200 characters; Vercel sends it as bearer authorization for the daily invocation |
| `SCANNER_JOB_MODE` | `external` (also the standalone entrypoint's default) |
| `SCANNER_STORAGE_LIMIT_BYTES` | `100000000` initially; never raise beyond measured free capacity |

Generate each token locally using `python -c "import secrets; print(secrets.token_urlsafe(32))"` and enter it directly into Vercel settings. No token value is generated into the bundle or shown in this chat. Missing/invalid database/TLS/secrets fail startup; hosted operation cannot fall back to SQLite. Vercel captures cron-secret changes on redeployment; see [cron security](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs).

### Optional raw EOD capture

Raw capture is **off by default**. After actually reviewing applicable personal-use permission, configure up to four explicit listings in `SCANNER_TEJHQ_RAW_LISTINGS` (comma separated), `SCANNER_TEJHQ_PERMISSION_REFERENCE=https://tejhq.dev/data-terms`, and the genuine ISO review date in `SCANNER_TEJHQ_TERMS_REVIEWED_ON` (within 90 days, not future dated). `SCANNER_TEJHQ_START_DATE` defaults to `2024-01-01`. The existing keyless client retains its 40-request/day, byte, burst, error and storage guards. No provider key, paid endpoint or fallback is used.

The daily endpoint reserves its UTC day durably before executing. Duplicate/concurrent calls and retries cannot automatically repeat an already reserved day. Raw capture responses expose only counts/capture ID, never prices or action bodies. Failed/interrupted daily reservations stay reserved: inspect private status and recover deliberately rather than re-triggering automatic downloads. A job interrupted by the platform remains subject to the explicit worker recovery procedure above.

Raw captures are quarantined. They do not extend the approved historical bundle or its calendar, manufacture corporate-action publication times, produce verified new signals, or establish all-stock coverage. Updating canonical charts beyond the reviewed import still requires a reviewed new bundle. Separate action verification, Nifty data and historical universe/delisting work remain blocked on permitted inputs. The 300-second function envelope and current immutable storage layout must be benchmarked/redesigned before broad all-equity operation.

The follow-up deployment-package checks passed: 77 PostgreSQL backend tests (including daily-secret isolation, duplicate/concurrent reservation, failure/no-replay behavior, raw-capture redaction and unchanged datasets), 100 Node tests, TypeScript, build and all four browser audits. The generated standalone package imports in the pinned Python 3.12 runtime and rejects missing hosted settings before database access. Its ZIP manifest was read back and every entry/hash checked. The private import JSON was read back through the real schema: 542,539 bytes, 2,880 candles, four equities, no action factors and strict verification gates still active. None of these local checks substitutes for a successful real Vercel build, Neon connection or live scheduled invocation.

## Packaging import fix and Windows redeployment

The original generated folder contained `scanner_service/__init__.py` and the runtime modules, but its Vercel function configuration did not explicitly retain the package. Its entrypoint also depended on the loader's import path. An isolated absolute-path loader reproduced `ModuleNotFoundError: No module named 'scanner_service'` against that original artifact.

The corrected generator copies all top-level Python modules, explicitly sets `functions.app.py.includeFiles` to `scanner_service/**`, adds the entrypoint's own directory to `sys.path`, sets portable read/traverse permissions on package files/directories inside the private output root, and replaces the blanket upload-ignore/reinclude rules with exclusions for credentials, caches, virtual environments and data files. Pinned runtime dependencies are unchanged. The generated `verify_bundle.py` checks hashes, `__init__.py`, relative imports, the actual `scanner_service.hosted` module location, and a fresh isolated absolute-path entrypoint load from another working directory. Its child process intentionally excludes database credentials, so it must reach the normal missing-settings error without database access. This is a packaging check, not a request to change deployed settings.

`npm run test:scanner:bundle` generates and tests a fresh artifact using `SCANNER_PYTHON` or the local Python interpreter with pinned dependencies installed. The exact corrected directory has additionally been tested in the pinned Python 3.12 container with only that directory mounted. No source-repository imports could satisfy missing files.

For redeployment, use PowerShell **inside the existing linked backend folder**, where `.vercel/project.json` was created by the previous deployment. The commands below fetch corrected source into a new temporary directory, preserve the existing project association by copying only `project.json`, generate and test a fresh release, and deploy to that same Vercel project. They do not create a database, link a new project or edit environment variables. Node.js and Python 3.12 (`py -3.12`) must be installed. No repository `npm install` is needed just to generate the package.

```powershell
$ErrorActionPreference = 'Stop'
$OldBackend = (Get-Location).Path
$ProjectLink = Join-Path $OldBackend '.vercel\project.json'
if (-not (Test-Path $ProjectLink)) { throw 'Open the existing linked backend folder first.' }

$Work = Join-Path $env:TEMP ('scanner-import-fix-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Work | Out-Null
Invoke-WebRequest -Uri 'https://github.com/kk9234282-art/testing-/archive/refs/heads/main.zip' -OutFile "$Work\source.zip"
Expand-Archive -LiteralPath "$Work\source.zip" -DestinationPath "$Work\source"
$Repo = (Get-ChildItem "$Work\source" -Directory | Select-Object -First 1).FullName
Push-Location $Repo
try {
    node .\scripts\prepare-hosted-scanner.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Bundle generation failed.' }
    $Release = Join-Path $Repo '.scanner-private\hosted-release'
    New-Item -ItemType Directory -Path "$Release\.vercel" | Out-Null
    Copy-Item -LiteralPath $ProjectLink -Destination "$Release\.vercel\project.json"

    py -3.12 -m venv "$Release\.venv"
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 virtual environment creation failed.' }
    $Python = Join-Path $Release '.venv\Scripts\python.exe'
    & $Python -m pip install -r "$Release\requirements.txt"
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & $Python -I -B "$Release\verify_bundle.py"
    if ($LASTEXITCODE -ne 0) { throw 'Package import verification failed; do not deploy.' }

    npx vercel --cwd "$Release" --prod
    if ($LASTEXITCODE -ne 0) { throw 'Vercel deployment failed.' }
} finally {
    Pop-Location
}
```

Do not run `vercel link` or select a new project: the existing link is reused. Your integration-managed `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and the existing `SCANNER_DATABASE_URL` remain in the same Vercel project unchanged. No credential rotation is required. Source verification, signal gates, daily schedule and free-service architecture are unchanged.

Check `/api/structure/health` on the **production alias or the new deployment URL printed by this command**. The previous immutable deployment URL still serves its previous broken build. Successful local packaging tests do not establish that the new remote deployment has succeeded; check its build/runtime logs if an error remains.

Final packaging validation: the old generated entrypoint reproduced `ModuleNotFoundError` under a fresh isolated absolute-path loader. Both a freshly generated audit artifact and the regenerated canonical `hosted-release` passed the corrected import probe from an unrelated working directory, using only the generated directory mounted into the pinned Python 3.12 runtime. All 100 Node tests passed, including complete Python-file copying, package initialization, explicit inclusion and POSIX permission checks. The final ZIP was opened and every manifest hash and Python-file read mode verified. The prior generated directory/archive were preserved privately. Live Vercel invocation still needs verification after redeploying this corrected build.
