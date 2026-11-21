"""Liveness and readiness.

`/health` answers as soon as the API process is serving. That is the right
question for Compose's healthcheck and for the header's status indicator, and
it deliberately touches nothing else, so it stays fast and cannot fail for a
reason outside this process.

`/ready` is the stricter question the loading screen asks: can this API do the
work it advertises? That means its memory store has to answer too, because
every retrieval route fails without it. The two are separate endpoints rather
than one, since a backend that is up but cannot reach Qdrant should still be
reported as alive — the distinction is what tells the user which container to
go and look at.
"""

from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from application.use_cases.system.check_readiness import CheckReadiness
from infrastructure.config import config
from infrastructure.memory_store.probe_qdrant import probe_qdrant

router = APIRouter(tags=["health"])

DependencyState = Literal["ok", "unavailable"]


class DependencyStatus(BaseModel):
    name: str
    label: str
    status: DependencyState
    detail: str


class ReadinessResponse(BaseModel):
    ready: bool
    checked_at: str
    dependencies: list[DependencyStatus]
    facts: dict


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/ready")
def ready(request: Request) -> ReadinessResponse:
    """Report every dependency the API needs before it can serve real work."""
    loaded = request.app.state.model_cache.loaded
    readiness = CheckReadiness(
        lambda: probe_qdrant(config.qdrant_url, config.qdrant_collection), config.api_title
    ).execute(loaded_model_id=loaded[0] if loaded else None)
    return ReadinessResponse(**asdict(readiness))
