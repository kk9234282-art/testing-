"""Bounded private batch worker; no scheduler, hosting plan or data download."""

import argparse
import json
import os
import time
import uuid
from .jobs import JobRequest, execute_job
from .storage import Store


def run_pending(store, max_jobs=2, start_budget_seconds=300):
    if not 1 <= max_jobs <= 20 or not 1 <= start_budget_seconds <= 3600:
        raise ValueError("Worker limits: 1–20 jobs and 1–3600 start-budget seconds")
    deadline = time.monotonic() + start_budget_seconds
    completed = []
    while len(completed) < max_jobs and time.monotonic() < deadline:
        run = store.claim_run()
        if run is None:
            break
        try:
            request = JobRequest.model_validate(run["request"])
            if request.dataset_id != run["dataset_id"]:
                raise ValueError("Queued request does not match its immutable dataset")
            execute_job(store, run["id"], run["kind"], request, claimed=True)
        except Exception:
            # Never log queued data or database connection strings.
            store.update(run["id"], state="failed", error="Invalid queued research request")
        completed.append({"run_id": run["id"], "state": store.get_run(run["id"])["state"]})
    return {"processed": completed, "provider_requests": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-jobs", type=int, default=2)
    parser.add_argument("--start-budget-seconds", type=int, default=300)
    parser.add_argument("--fail-interrupted", type=uuid.UUID, help="Fail a running job only after confirming its worker stopped; never auto-retry")
    args = parser.parse_args()
    if os.getenv("SCANNER_JOB_MODE", "embedded") != "external":
        parser.error("Set SCANNER_JOB_MODE=external on both the API and batch worker; do not mix execution modes")
    store = Store()
    try:
        if args.fail_interrupted:
            store.fail_interrupted(str(args.fail_interrupted))
            print(json.dumps({"run_id": str(args.fail_interrupted), "state": "failed"}))
        else:
            print(json.dumps(run_pending(store, args.max_jobs, args.start_budget_seconds)))
    finally:
        store.engine.dispose()


if __name__ == "__main__":
    main()
