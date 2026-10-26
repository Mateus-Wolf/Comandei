from contextlib import asynccontextmanager
from collections import Counter, OrderedDict
import json
import logging
import os
from threading import Lock
import time
from uuid import UUID, uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from starlette.exceptions import HTTPException

from .core import config
from .core.db import engine, check_database
from .core.errors import APIError
from .routes import router
from .schemas import ErrorEnvelope

logger = logging.getLogger("comandei")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)
logger.propagate = False
counts = Counter()
metrics_lock = Lock()


@asynccontextmanager
async def lifespan(app):
    # Blocking SQL never executes on the event loop in request handlers.
    from starlette.concurrency import run_in_threadpool

    await run_in_threadpool(check_database)
    yield
    engine.dispose()


app = FastAPI(
    title="Comandei API",
    version="1.0.0",
    lifespan=lifespan,
    responses={code: {"model": ErrorEnvelope} for code in (401, 403, 404, 409, 422, 429, 503)},
    description="API operacional de restaurantes. Valores em centavos, quantidades em strings decimais. "
    "Comandos operacionais exigem Idempotency-Key. Recibos e registros de pagamentos são não fiscais.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"],
    expose_headers=["X-Request-ID", "Idempotency-Replayed", "Retry-After"],
)


def error_response(request, status, code, message, details=None):
    headers = {
        "Cache-Control": "no-store",
        "X-Request-ID": str(getattr(request.state, "request_id", uuid4())),
    }
    if status == 401:
        headers["WWW-Authenticate"] = "Bearer"
    if status in (429, 503):
        headers["Retry-After"] = "60" if status == 429 else "2"
    return JSONResponse(
        {
            "error": {
                "code": code,
                "message": message,
                "request_id": headers["X-Request-ID"],
                "details": details or {},
            }
        },
        status_code=status,
        headers=headers,
    )


@app.exception_handler(APIError)
async def api_error(request, error):
    return error_response(request, error.status, error.code, error.message, error.details)


@app.exception_handler(RequestValidationError)
async def validation_error(request, error):
    details = [{"location": list(e["loc"]), "type": e["type"], "message": e["msg"]} for e in error.errors()]
    return error_response(
        request, 422, "VALIDATION_ERROR", "Confira os dados informados.", {"fields": details}
    )


@app.exception_handler(DBAPIError)
async def database_error(request, error):
    code = getattr(error.orig, "sqlstate", None)
    if code == "23505":
        return error_response(
            request, 409, "DUPLICATE_RESOURCE", "Já existe uma operação ou cadastro com essa referência."
        )
    if code == "23503":
        return error_response(
            request, 422, "INVALID_REFERENCE", "Referência inválida ou indisponível neste restaurante."
        )
    if code == "23514":
        return error_response(
            request,
            409,
            "BUSINESS_CONSTRAINT",
            "A operação viola uma regra de integridade; confira limites, proprietários e estado do recurso.",
        )
    if code == "42501":
        return error_response(request, 403, "FORBIDDEN", "Operação não autorizada.")
    if code == "P0002":
        return error_response(request, 404, "NOT_FOUND", "Recurso não encontrado.")
    logger.error(
        json.dumps(
            {
                "event": "database_failure",
                "sqlstate": code,
                "request_id": str(getattr(request.state, "request_id", "")),
            }
        )
    )
    return error_response(
        request,
        503,
        "DATABASE_UNAVAILABLE",
        "Operação temporariamente indisponível. Repita com a mesma chave.",
    )


@app.exception_handler(HTTPException)
async def http_error(request, error):
    return error_response(
        request, error.status_code, "HTTP_ERROR", "Rota, método ou requisição indisponível."
    )


@app.exception_handler(Exception)
async def unexpected_error(request, error):
    logger.error(
        json.dumps(
            {
                "event": "unexpected_failure",
                "type": type(error).__name__,
                "request_id": str(getattr(request.state, "request_id", "")),
            }
        )
    )
    return error_response(request, 500, "INTERNAL_ERROR", "Não foi possível concluir a operação.")


@app.middleware("http")
async def request_context(request: Request, call_next):
    try:
        request.state.request_id = UUID(request.headers.get("X-Request-ID", ""))
    except ValueError:
        request.state.request_id = uuid4()
    started = time.monotonic()
    response = await call_next(request)
    response.headers["X-Request-ID"] = str(request.state.request_id)
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    path = getattr(request.scope.get("route"), "path", "unmatched")
    method = (
        request.method
        if request.method in ("GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS")
        else "OTHER"
    )
    elapsed = round((time.monotonic() - started) * 1000)
    with metrics_lock:
        counts[(method, path, response.status_code)] += 1
    logger.info(
        json.dumps(
            {
                "event": "http_request",
                "request_id": str(request.state.request_id),
                "method": request.method,
                "route": path,
                "status": response.status_code,
                "duration_ms": elapsed,
            }
        )
    )
    return response


class AdmissionMiddleware:
    """Bound request size and unauthenticated IP traffic before expensive JWT work."""

    def __init__(self, app):
        self.app = app
        self.clients = OrderedDict()
        self.lock = Lock()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        ip = (scope.get("client") or ("unknown",))[0]
        bucket = int(time.monotonic() // 60)
        with self.lock:
            old_bucket, hits = self.clients.pop(ip, (bucket, 0))
            hits = hits + 1 if old_bucket == bucket else 1
            self.clients[ip] = (bucket, hits)
            while len(self.clients) > 10000:
                self.clients.popitem(last=False)
        if hits > 600:
            response = JSONResponse(
                {
                    "error": {
                        "code": "RATE_LIMITED",
                        "message": "Limite de requisições.",
                        "request_id": str(uuid4()),
                        "details": {},
                    }
                },
                status_code=429,
                headers={"Retry-After": "60", "Cache-Control": "no-store"},
            )
            return await response(scope, receive, send)
        # Buffer only up to 256 KiB, including requests without Content-Length.
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > 262144:
                response = JSONResponse(
                    {
                        "error": {
                            "code": "BODY_TOO_LARGE",
                            "message": "Requisição muito grande.",
                            "request_id": str(uuid4()),
                            "details": {},
                        }
                    },
                    status_code=413,
                )
                return await response(scope, receive, send)
            chunks.append(message)
            if not message.get("more_body", False):
                break

        async def replay():
            return chunks.pop(0) if chunks else await receive()

        await self.app(scope, replay, send)


app.add_middleware(AdmissionMiddleware)
app.include_router(router)


@app.get("/health/live", tags=["Health"])
def live():
    return {"status": "ok"}


@app.get("/health/ready", tags=["Health"])
def ready():
    with engine.connect() as connection:
        connection.execute(text("select 1"))
    return {"status": "ready"}


@app.get("/internal/metrics", include_in_schema=False)
def metrics(request: Request):
    from secrets import compare_digest

    expected = os.getenv("METRICS_TOKEN", "")
    if not expected or not compare_digest(request.headers.get("Authorization", ""), f"Bearer {expected}"):
        raise APIError(404, "NOT_FOUND", "Recurso não encontrado.")
    with metrics_lock:
        lines = [
            f'comandei_http_requests_total{{method="{method}",route="{path}",status="{status}"}} {value}'
            for (method, path, status), value in counts.items()
        ]
    return PlainTextResponse("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")
