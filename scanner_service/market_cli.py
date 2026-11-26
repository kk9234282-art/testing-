"""Private manual update/validation command; no cloud billing or scheduler API."""

import argparse
import json
from pathlib import Path
from .storage import Store, Run
from .market_data import MarketData
from .research import Context
from .schema import Parameters
from .validation import validate_history, supplementary_breadth
from sqlalchemy import select


def main():
    parser = argparse.ArgumentParser(
        description="Free private EOD imports; no paid fallback"
    )
    parser.add_argument("command", choices=["update", "status", "validate", "breadth"])
    parser.add_argument(
        "input",
        nargs="?",
        help="Private config JSON for update; dataset SHA for validation/breadth",
    )
    parser.add_argument(
        "--scan",
        action="store_true",
        help="Recalculate after a successful update (reuse identical completed scan)",
    )
    parser.add_argument(
        "--every-prefix",
        action="store_true",
        help="Audit each historical session, rather than event dates only",
    )
    parser.add_argument("--output", help="Write private report JSON, never to public/")
    args = parser.parse_args()
    store = Store()
    service = MarketData(store)
    if args.command == "status":
        result = service.statuses()
    elif args.command == "update":
        if not args.input:
            parser.error("update requires a private configuration file")
        result = service.update(json.loads(Path(args.input).read_text()))
        if args.scan:
            bundle = store.load(result["dataset_id"])
            with store.session() as db:
                existing = next(
                    (
                        r
                        for r in db.scalars(
                            select(Run).where(
                                Run.dataset_id == result["dataset_id"],
                                Run.kind == "scan",
                                Run.state == "complete",
                            )
                        )
                        if r.request.get("as_of")
                        == str(bundle.manifest.latest_complete_session)
                        and r.request.get("parameters") == Parameters().model_dump()
                    ),
                    None,
                )
            if existing:
                result["scan_run_id"] = existing.id
            else:
                request = {
                    "dataset_id": result["dataset_id"],
                    "as_of": str(bundle.manifest.latest_complete_session),
                    "parameters": Parameters().model_dump(),
                }
                run = store.create_run(result["dataset_id"], "scan", request)
                try:
                    store.update(run, state="running")
                    store.update(
                        run,
                        state="complete",
                        result=Context(bundle).scan(
                            bundle.manifest.latest_complete_session, Parameters()
                        ),
                    )
                except Exception:
                    store.update(
                        run,
                        state="failed",
                        error="Post-import scan failed; inspect private source data",
                    )
                    raise
                result["scan_run_id"] = run
    else:
        if not args.input:
            parser.error("validation requires an imported dataset SHA")
        bundle = store.load(args.input)
        result = (
            validate_history(bundle, every_prefix=args.every_prefix)
            if args.command == "validate"
            else supplementary_breadth(bundle, bundle.manifest.latest_complete_session)
        )
    encoded = json.dumps(result, indent=2, allow_nan=False)
    if args.output:
        destination = Path(args.output).resolve()
        # Prevent accidental public export of restricted real source data/reports.
        root = Path(__file__).resolve().parents[1]
        for public in (root / "public", root / "dist"):
            if destination == public or public in destination.parents:
                parser.error(
                    "Private market data cannot be exported into public/ or dist/"
                )
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        destination.write_text(encoded)
        destination.chmod(0o600)
        print("Private report written")
    else:
        print(encoded)


if __name__ == "__main__":
    main()
