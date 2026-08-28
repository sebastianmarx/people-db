"""FastAPI application and Lambda entry point."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from mangum import Mangum

from app.config import settings
from app.routers import auth_routes, chat_routes, people

logging.basicConfig(level=settings.log_level)
logging.getLogger("app").setLevel(settings.log_level)

app = FastAPI(
    title="people_db API",
    version="0.1.0",
    # The API is private; there is no reason to publish a schema.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.include_router(auth_routes.router)
app.include_router(people.router)
app.include_router(chat_routes.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    """Unauthenticated liveness probe. Deliberately returns no data."""
    return {"status": "ok"}


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    # Log the detail, return none of it: error bodies are a disclosure channel.
    logging.getLogger("app").exception("unhandled error on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal error."})


# Mangum translates the Lambda Function URL (payload format 2.0) event into ASGI.
handler = Mangum(app, lifespan="off")
