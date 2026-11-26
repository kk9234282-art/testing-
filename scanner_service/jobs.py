"""Shared EOD execution for the embedded service and an external batch worker."""

from datetime import date
from pydantic import Field
from .schema import Model, Parameters
from .research import Context
from .backtest import outcomes


class JobRequest(Model):
    dataset_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    as_of: date
    parameters: Parameters = Parameters()
    signal: str = Field(default="confirmed", pattern=r"^(initial|confirmed)$")
    fee_bps: float = Field(default=10, ge=0, le=100)
    slippage_bps: float = Field(default=5, ge=0, le=100)


def execute_job(store, run_id, kind, request, *, claimed=False):
    try:
        if not claimed:
            store.update(run_id, state="running")
        context = Context(store.load(request.dataset_id))
        if kind not in ("scan", "backtest"):
            raise ValueError("Unknown research job")
        if (
            request.as_of > context.bundle.manifest.latest_complete_session
            or request.as_of not in context.sessions
        ):
            raise ValueError("Choose a complete dataset session")
        result = (
            context.scan(request.as_of, request.parameters)
            if kind == "scan"
            else outcomes(
                context,
                request.as_of,
                request.parameters,
                request.signal,
                request.fee_bps,
                request.slippage_bps,
            )
        )
        store.update(run_id, state="complete", result=result)
    except Exception as error:
        store.update(run_id, state="failed", error=str(error)[:500])
