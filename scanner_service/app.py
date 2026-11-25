import os
import hmac
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from fastapi import FastAPI, Depends, Header, HTTPException, Response, Request
from pydantic import Field
from .schema import Bundle, Model, Parameters
from .storage import Store, Run
from .research import Context
from .backtest import outcomes
from sqlalchemy import select


class JobRequest(Model):
    dataset_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    as_of: date
    parameters: Parameters = Parameters()
    signal: str = Field(default="confirmed", pattern=r"^(initial|confirmed)$")
    fee_bps: float = Field(default=10, ge=0, le=100)
    slippage_bps: float = Field(default=5, ge=0, le=100)


def create_app(store=None, token=None):
    store = store or Store()
    secret = token if token is not None else os.getenv("SCANNER_ADMIN_TOKEN", "")
    if token is None and (len(secret) < 24 or secret.startswith("replace-with")):
        secret = ""
    app = FastAPI(
        title="Indian Bullish Structure Scanner",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="structure-eod")
    # A process restart never leaves a queued job pretending it is progressing.
    with store.session() as db:
        for run in db.scalars(select(Run).where(Run.state.in_(["queued", "running"]))):
            run.state = "failed"
            run.error = "Service restarted. Submit a new reproducible run."
        db.commit()

    def auth(authorization: str = Header(default="")):
        if not secret:
            raise HTTPException(
                503, "Configure SCANNER_ADMIN_TOKEN before connecting a private dataset"
            )
        if not hmac.compare_digest(authorization.encode(), f"Bearer {secret}".encode()):
            raise HTTPException(401, "Invalid research service token")

    @app.middleware("http")
    async def private_headers(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/api/structure/health")
    def health():
        return {
            "service": "structure-eod",
            "ready": bool(secret),
            "database": store.engine.dialect.name,
            "licensed_provider_connected": False,
        }

    @app.get("/api/structure/datasets", dependencies=[Depends(auth)])
    def datasets():
        return store.datasets()

    @app.post("/api/structure/import", dependencies=[Depends(auth)])
    async def upload(request: Request):
        if int(request.headers.get("content-length", "0")) > 3_000_000:
            raise HTTPException(
                413, "Browser import limit is 3 MB; use the CLI for full-universe files"
            )
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 3_000_000:
                raise HTTPException(413, "Use the CLI for imports above 3 MB")
        try:
            bundle = Bundle.model_validate_json(body)
            return {
                "dataset_id": store.save(bundle),
                "manifest": bundle.manifest.model_dump(mode="json"),
            }
        except ValueError as e:
            raise HTTPException(422, str(e)[:2000])

    def work(run_id, kind, request):
        try:
            store.update(run_id, state="running")
            context = Context(store.load(request.dataset_id))
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
        except Exception as e:
            store.update(run_id, state="failed", error=str(e)[:500])

    @app.post(
        "/api/structure/runs/{kind}", dependencies=[Depends(auth)], status_code=202
    )
    def queue(kind: str, request: JobRequest):
        if kind not in ("scan", "backtest"):
            raise HTTPException(400, "Unknown research job")
        try:
            identity = store.create_run(
                request.dataset_id, kind, request.model_dump(mode="json")
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        executor.submit(work, identity, kind, request)
        return {"run_id": identity, "state": "queued"}

    @app.get("/api/structure/runs/{run_id}", dependencies=[Depends(auth)])
    def run(run_id: str):
        try:
            return store.get_run(run_id)
        except ValueError as e:
            raise HTTPException(404, str(e))

    @app.get(
        "/api/structure/runs/{run_id}/stocks/{security_id}",
        dependencies=[Depends(auth)],
    )
    def stock(run_id: str, security_id: str):
        try:
            run = store.get_run(run_id)
            if run["kind"] != "scan" or run["state"] != "complete":
                raise ValueError("Stock pages require a completed scan")
            request = JobRequest.model_validate(run["request"])
            return Context(store.load(run["dataset_id"])).stock(
                security_id, request.as_of, request.parameters
            )
        except ValueError as e:
            raise HTTPException(404, str(e))

    app.state.store = store
    app.state.executor = executor
    return app


app = create_app()
