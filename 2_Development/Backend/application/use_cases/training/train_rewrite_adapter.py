import logging
from dataclasses import asdict
from uuid import uuid4

from application.ports.models.rewrite_trainer import RewriteTrainerPort
from application.ports.training.artifacts import ArtifactStore, TrainingWorker

from .training_run import ACTIVE_STATUSES, ArtifactConflict, TrainingRun, TrainingSettings, utc_now


logger = logging.getLogger(__name__)


class StartTrainingRun:
    def __init__(self, store: ArtifactStore, worker: TrainingWorker) -> None:
        self.store = store
        self.worker = worker

    def execute(
        self,
        dataset_id: str,
        *,
        model_id: str,
        revision: str | None,
        device: str,
        settings: TrainingSettings,
        name: str | None,
        notes: str,
    ) -> dict:
        if device not in {"cpu", "cuda"}:
            raise ValueError("Training device must be cpu, gpu, or cuda. Check LLM_DEVICE.")
        with self.store.transaction():
            self.store.recover_interrupted()
            if any(run["status"] in ACTIVE_STATUSES for run in self.store.list_artifacts("runs")):
                raise ArtifactConflict("A training run is already active.")
            dataset = self.store.get("datasets", dataset_id)
            if dataset["provenance"].get("partition") != "train":
                raise ValueError("Fine-tuning requires a reward dataset built from a training partition.")
            self.store.load_examples(dataset_id, dataset["dataset_sha256"])
            run = TrainingRun(
                id=str(uuid4()), dataset_id=dataset["id"], dataset_sha256=dataset["dataset_sha256"],
                reward=dataset["reward"], model_id=model_id, requested_revision=revision,
                device=device, settings=settings, name=name or f"{dataset['reward'].upper()} LoRA",
                notes=notes,
            )
            record = self.store.write("runs", run.id, asdict(run))
            try:
                self.worker.launch(run)
            except Exception:
                logger.exception("Could not start training worker for %s", run.id)
                record.update(status="failed", error="Could not start the training worker.",
                              updated_at=utc_now())
                return self.store.write("runs", run.id, record)
            return record


class TrainRewriteAdapter:
    def __init__(self, store: ArtifactStore, trainer: RewriteTrainerPort) -> None:
        self.store = store
        self.trainer = trainer

    def execute(self, run_id: str) -> None:
        with self.store.transaction():
            record = self.store.get("runs", run_id)
            if record["status"] != "queued":
                raise ArtifactConflict("Only a queued run can be started.")
            self._update(run_id, status="running")

        def report_progress(progress: dict) -> None:
            with self.store.transaction():
                self._update(run_id, progress=progress)

        try:
            examples = self.store.load_examples(record["dataset_id"], record["dataset_sha256"])
            with self.store.stage_adapter(run_id) as output:
                revision, metrics = self.trainer.train(
                    examples, model_id=record["model_id"], revision=record["requested_revision"],
                    device=record["device"], settings=TrainingSettings(**record["settings"]),
                    output=output, report_progress=report_progress,
                )
                with self.store.transaction():
                    self.store.publish_adapter(run_id, output)
                    self._update(run_id, status="completed", model_revision=revision,
                                 adapter_path="adapter", metrics=metrics)
        except Exception as error:
            logger.exception("Training run %s failed", run_id)
            detail = str(error) if isinstance(error, ValueError) else (
                "Training failed. Check the backend logs for the model or device error."
            )
            with self.store.transaction():
                self.store.discard_adapter(run_id)
                self._update(run_id, status="failed", error=detail)

    def _update(self, run_id: str, **changes: object) -> None:
        current = self.store.get("runs", run_id)
        current.update(changes, updated_at=utc_now())
        self.store.write("runs", run_id, current)
