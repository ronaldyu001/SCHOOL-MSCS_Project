from dataclasses import asdict
from uuid import UUID

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from application.use_cases.evaluation import EvaluationMode
from application.use_cases.evaluation.start_evaluation import StartEvaluation
from infrastructure.evaluation.runtime import load_benchmark

from .artifact_routes import artifact_errors, artifact_router


router = APIRouter(prefix="/evaluation", tags=["evaluation"])
router.include_router(artifact_router("/runs", "evaluations"))


class StartEvaluationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    adapters: dict[int, dict[str, UUID]] = Field(min_length=1)
    mode: EvaluationMode = "official"
    pilot_limit: int | None = Field(default=None, ge=1, strict=True)


@router.get("/benchmark")
def benchmark_info() -> dict:
    return asdict(load_benchmark())


@router.post("/runs", status_code=202)
def start_evaluation(body: StartEvaluationRequest, request: Request, response: Response) -> dict:
    adapters = {seed: {reward: str(run_id) for reward, run_id in items.items()}
                for seed, items in body.adapters.items()}
    with artifact_errors():
        run = StartEvaluation(
            request.app.state.artifact_store, request.app.state.training_worker.launch_evaluation,
        ).execute(load_benchmark(), body.mode, adapters, pilot_limit=body.pilot_limit)
    response.headers["Location"] = f"/evaluation/runs/{run['id']}"
    return run
