from dataclasses import dataclass, field
from datetime import datetime, timezone
from math import isfinite
from typing import Literal, TypeAlias


ArtifactKind: TypeAlias = Literal["datasets", "runs", "evaluations"]
RunStatus: TypeAlias = Literal["queued", "running", "completed", "failed", "interrupted"]
ACTIVE_STATUSES = frozenset({"queued", "running"})


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ArtifactNotFound(LookupError):
    pass


class ArtifactConflict(RuntimeError):
    pass


@dataclass(frozen=True)
class TrainingSettings:
    seed: int = 123
    epochs: int = 1
    learning_rate: float = 0.0002
    batch_size: int = 1
    gradient_accumulation_steps: int = 4
    max_length: int = 512
    lora_rank: int = 8
    lora_alpha: int = 16

    def __post_init__(self) -> None:
        limits = {
            "seed": (0, 2**32 - 1),
            "epochs": (1, 20),
            "batch_size": (1, 32),
            "gradient_accumulation_steps": (1, 128),
            "max_length": (32, 32768),
            "lora_rank": (1, 256),
            "lora_alpha": (1, 512),
        }
        for name, (lower, upper) in limits.items():
            value = getattr(self, name)
            if type(value) is not int or not lower <= value <= upper:
                raise ValueError(f"{name} must be an integer between {lower} and {upper}.")
        if not isfinite(self.learning_rate) or not 0 < self.learning_rate <= 1:
            raise ValueError("learning_rate must be finite and between 0 (exclusive) and 1.")


@dataclass(frozen=True)
class TrainingRun:
    id: str
    dataset_id: str
    dataset_sha256: str
    reward: str
    model_id: str
    requested_revision: str | None
    device: str
    settings: TrainingSettings
    name: str
    notes: str = ""
    status: RunStatus = "queued"
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)
    model_revision: str | None = None
    adapter_path: str | None = None
    progress: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)
    error: str | None = None
    dataset_provenance: dict = field(default_factory=dict)
    adapter_sha256: dict[str, str] = field(default_factory=dict)
    runtime: dict = field(default_factory=dict)
