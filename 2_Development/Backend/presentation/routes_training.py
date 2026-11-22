from uuid import UUID

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from application.use_cases.training.train_rewrite_adapter import StartTrainingRun
from application.use_cases.training.training_run import TrainingSettings
from infrastructure.config import config

from .artifact_routes import ArtifactName, ArtifactNotes, artifact_errors, artifact_router
from .resources import resolve_checkpoint
from .routes_model import MODEL_ID_PATTERN


router = APIRouter(prefix="/training", tags=["training"])
router.include_router(artifact_router("/runs", "runs"))


class TrainingSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    seed: int = config.training_defaults.seed
    epochs: int = config.training_defaults.epochs
    learning_rate: float = config.training_defaults.learning_rate
    batch_size: int = config.training_defaults.batch_size
    gradient_accumulation_steps: int = config.training_defaults.gradient_accumulation_steps
    max_length: int = config.training_defaults.max_length
    lora_rank: int = config.training_defaults.lora_rank
    lora_alpha: int = config.training_defaults.lora_alpha


class StartTrainingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_id: UUID
    model_id: str | None = Field(default=None, max_length=193, pattern=MODEL_ID_PATTERN)
    revision: str | None = Field(default=None, pattern=r"\S", max_length=200)
    name: ArtifactName | None = None
    notes: ArtifactNotes = ""
    settings: TrainingSettingsRequest = Field(default_factory=TrainingSettingsRequest)


@router.post("/runs", status_code=202)
def start_training(body: StartTrainingRequest, request: Request, response: Response) -> dict:
    model_id, revision = resolve_checkpoint(body.model_id, body.revision)
    device = "cuda" if config.training_device == "gpu" else config.training_device
    with artifact_errors():
        record = StartTrainingRun(
            request.app.state.artifact_store, request.app.state.training_worker,
        ).execute(
            str(body.dataset_id), model_id=model_id, revision=revision, device=device,
            settings=TrainingSettings(**body.settings.model_dump()),
            name=body.name, notes=body.notes,
        )
    response.headers["Location"] = f"/training/runs/{record['id']}"
    return record
