import logging
from collections.abc import Callable, Iterable

from application.ports.training.evaluation_artifacts import EvaluationArtifacts
from application.use_cases.training.training_run import ArtifactConflict, utc_now

from .benchmark import BenchmarkConfig
from .summarize import summarize

logger = logging.getLogger(__name__)


class RunEvaluation:
    def __init__(
        self, store: EvaluationArtifacts,
        evaluate: Callable[[dict, BenchmarkConfig, Callable[[dict], None]], tuple[Iterable[dict], dict, dict]],
    ) -> None:
        self._store = store
        self._evaluate = evaluate

    def execute(self, run_id: str) -> None:
        with self._store.transaction():
            record = self._store.get("evaluations", run_id)
            if record["status"] != "queued":
                raise ArtifactConflict("Only a queued evaluation can be started.")
            self._update(run_id, status="running")

        def report(progress: dict) -> None:
            with self._store.transaction():
                self._update(run_id, progress=progress)

        try:
            benchmark = BenchmarkConfig.from_dict(record["benchmark"])
            observations, excluded, runtime = self._evaluate(record, benchmark, report)
            rows = list(observations)
            summary = summarize(rows, excluded)
            if not summary["curves"]:
                raise ValueError("The evaluation produced no scoreable rows.")
            with self._store.transaction():
                self._store.publish_evaluation(run_id, summary, rows)
                self._update(run_id, status="completed", summary=summary, runtime=runtime,
                             progress={"phase": "completed"})
        except Exception as error:
            logger.exception("Evaluation %s failed", run_id)
            detail = str(error) if isinstance(error, (FileNotFoundError, ValueError)) else (
                "Evaluation failed. Check the backend logs for the model or retrieval error."
            )
            with self._store.transaction():
                self._store.discard_evaluation(run_id)
                self._update(run_id, status="failed", error=detail)

    def _update(self, run_id: str, **changes: object) -> None:
        record = self._store.get("evaluations", run_id)
        record.update(changes, updated_at=utc_now())
        self._store.write("evaluations", run_id, record)
