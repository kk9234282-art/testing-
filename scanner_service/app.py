import os
import hmac
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, Depends, Header, HTTPException, Response, Request
from .schema import Bundle
from .storage import Store, Run
from .research import Context
from .jobs import JobRequest, execute_job
from .market_data import MarketData
from .quality import needs_action_review, raw_stock
from sqlalchemy import select


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
    mode = os.getenv("SCANNER_JOB_MODE", "embedded")
    if mode not in ("embedded", "external"):
        raise ValueError("SCANNER_JOB_MODE must be embedded or external")
    executor = (
        ThreadPoolExecutor(max_workers=1, thread_name_prefix="structure-eod")
        if mode == "embedded" else None
    )
    # Only the persistent embedded service owns its process-local jobs.
    # Short-lived API instances must not cancel work owned by a batch worker.
    if mode == "embedded":
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
            "job_mode": mode,
            "licensed_provider_connected": False,
        }

    @app.get("/api/structure/datasets", dependencies=[Depends(auth)])
    def datasets():
        return store.datasets()

    @app.get("/api/structure/market-data/status", dependencies=[Depends(auth)])
    def market_status():
        result = MarketData(store).statuses()
        daily_status = getattr(app.state, "daily_status", None)
        if daily_status is not None:
            result["daily_batch"] = daily_status()
        return result

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
        if executor is not None:
            executor.submit(execute_job, store, identity, kind, request)
        return {"run_id": identity, "state": "queued", "job_mode": mode}

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
            context = Context(store.load(run["dataset_id"]))
            if needs_action_review(context.bundle.manifest.model_dump()):
                return raw_stock(context, security_id, request.as_of)
            return context.stock(security_id, request.as_of, request.parameters)
        except ValueError as e:
            raise HTTPException(404, str(e))

    app.state.store = store
    app.state.executor = executor
    app.state.job_mode = mode
    return app


app = create_app()
