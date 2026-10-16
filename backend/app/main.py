import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .database import SessionLocal, init_db
from .routers import analysis, auth, dashboard, generation, knowledge, scenarios, simulations, systems
from .services.agent import fail_interrupted_runs

settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")


# At import rather than in the lifespan hook, which serverless runtimes may not call.
init_db()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # With inline runs, several instances share the database and another one may be mid-run.
    if not settings.inline_runs:
        with SessionLocal() as db:
            fail_interrupted_runs(db)
    yield


app = FastAPI(title="Scenario Generator API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_handler(_request: Request, error: RequestValidationError) -> JSONResponse:
    """Same shape as FastAPI's default, but with JSON-safe `ctx` and without echoing inputs (e.g. passwords)."""
    detail = [
        {"loc": list(item["loc"]), "msg": item["msg"], "type": item["type"]} for item in error.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": detail})


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, error: Exception) -> JSONResponse:
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error."})


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}


for module in (auth, systems, scenarios, simulations, analysis, generation, knowledge, dashboard):
    app.include_router(module.router, prefix=settings.api_prefix)
