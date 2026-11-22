from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Protocol

from application.use_cases.training.build_reward_dataset import TrainingExample
from application.use_cases.training.training_run import TrainingSettings


class RewriteTrainerPort(Protocol):
    def train(
        self,
        examples: Sequence[TrainingExample],
        *,
        model_id: str,
        revision: str | None,
        device: str,
        settings: TrainingSettings,
        output: Path,
        report_progress: Callable[[dict], None],
    ) -> tuple[str, dict]:
        """Write adapter files to output and return the resolved revision and metrics."""
        ...
