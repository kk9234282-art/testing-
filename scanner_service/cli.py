import argparse
from datetime import date
from .schema import Bundle, Parameters
from .storage import Store
from .research import Context
from .backtest import outcomes


def main():
    parser = argparse.ArgumentParser(
        description="Private daily research dataset and batch runner"
    )
    parser.add_argument("command", choices=["import", "scan", "backtest"])
    parser.add_argument(
        "input", help="Bundle file for import, dataset SHA-256 for research"
    )
    parser.add_argument("--as-of", type=date.fromisoformat)
    args = parser.parse_args()
    store = Store()
    if args.command == "import":
        with open(args.input) as file:
            bundle = Bundle.model_validate_json(file.read())
        print(store.save(bundle))
        return
    bundle = store.load(args.input)
    day = args.as_of or bundle.manifest.latest_complete_session
    params = Parameters()
    request = {
        "dataset_id": args.input,
        "as_of": str(day),
        "parameters": params.model_dump(),
        "signal": "confirmed",
        "fee_bps": 10,
        "slippage_bps": 5,
    }
    identity = store.create_run(args.input, args.command, request)
    try:
        store.update(identity, state="running")
        context = Context(bundle)
        result = (
            context.scan(day, params)
            if args.command == "scan"
            else outcomes(context, day, params)
        )
        store.update(identity, state="complete", result=result)
        print(identity)
    except Exception as e:
        store.update(identity, state="failed", error=str(e)[:500])
        raise


if __name__ == "__main__":
    main()
