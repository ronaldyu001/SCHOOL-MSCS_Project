import logging
from collections.abc import Callable
from dataclasses import asdict
from re import fullmatch
from uuid import uuid4

from application.ports.models.llm import MAX_MODEL_ID_LENGTH, MODEL_ID_PATTERN
from application.ports.models.rewrite_trainer import RewriteTrainerPort
from application.ports.training.artifacts import ArtifactStore, TrainingWorker

from .training_run import ACTIVE_STATUSES, ArtifactConflict, TrainingRun, TrainingSettings, utc_now


logger = logging.getLogger(__name__)


class StartTrainingRun:
    def __init__(
        self,
        store: ArtifactStore,
        worker: TrainingWorker,
        *,
        default_checkpoint: tuple[str, str],
        validate_model_id: Callable[[str], None],
    ) -> None:
        self.store = store
        self.worker = worker
        self._default_checkpoint = default_checkpoint
        self._validate_model_id = validate_model_id

    def execute(
        self,
        dataset_id: str,
        *,
        model_id: str | None = None,
        revision: str | None = None,
        device: str,
        settings: TrainingSettings,
        name: str | None,
        notes: str,
    ) -> dict:
        if device not in {"cpu", "cuda"}:
            raise ValueError("Training device must be cpu, gpu, or cuda. Check LLM_DEVICE.")
        with self.store.transaction():
            self.store.recover_interrupted()
            if self.store.compute_busy() or any(run["status"] in ACTIVE_STATUSES for run in (
                self.store.list_artifacts("runs") + self.store.list_artifacts("evaluations")
            )):
                raise ArtifactConflict("Training or evaluation is already active.")
            dataset = self.store.get("datasets", dataset_id)
            provenance = dataset.get("provenance")
            if not isinstance(provenance, dict) or provenance.get("partition") != "train":
                raise ValueError("Fine-tuning requires a reward dataset built from a training partition.")
            self.store.load_examples(dataset_id, dataset["dataset_sha256"])
            selected_model, selected_revision = self._select_checkpoint(provenance, model_id, revision)
            self._validate_model_id(selected_model)
            run = TrainingRun(
                id=str(uuid4()), dataset_id=dataset["id"], dataset_sha256=dataset["dataset_sha256"],
                reward=dataset["reward"], model_id=selected_model, requested_revision=selected_revision,
                device=device, settings=settings, name=name or f"{dataset['reward'].upper()} LoRA",
                notes=notes,
                dataset_provenance=provenance,
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

    def _select_checkpoint(
        self, provenance: dict[str, object], model_id: str | None, revision: str | None,
    ) -> tuple[str, str | None]:
        """Use the dataset as the default only when its checkpoint is pinned."""
        default_model, default_revision = self._default_checkpoint
        recorded_model = provenance.get("model_id")
        recorded_revision = provenance.get("model_revision")
        if (
            isinstance(recorded_model, str)
            and len(recorded_model) <= MAX_MODEL_ID_LENGTH
            and fullmatch(MODEL_ID_PATTERN, recorded_model)
            and isinstance(recorded_revision, str)
            and fullmatch(r"[0-9a-fA-F]{40}", recorded_revision)
        ):
            default_model, default_revision = recorded_model, recorded_revision.lower()

        selected_model = model_id if model_id is not None else default_model
        if revision is None and selected_model == default_model:
            revision = default_revision
        return selected_model, revision


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
            update = {"progress": {key: value for key, value in progress.items() if key != "runtime"}}
            if "runtime" in progress:
                update["runtime"] = progress["runtime"]
            with self.store.transaction():
                self._update(run_id, **update)

        try:
            examples = self.store.load_examples(record["dataset_id"], record["dataset_sha256"])
            with self.store.stage_adapter(run_id) as output:
                revision, metrics = self.trainer.train(
                    examples, model_id=record["model_id"], revision=record["requested_revision"],
                    device=record["device"], settings=TrainingSettings(**record["settings"]),
                    output=output, report_progress=report_progress,
                )
                with self.store.transaction():
                    hashes = self.store.publish_adapter(run_id, output)
                    self._update(run_id, status="completed", model_revision=revision,
                                 adapter_path="adapter", adapter_sha256=hashes, metrics=metrics)
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
