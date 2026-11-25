import logging
from collections.abc import Callable
from dataclasses import asdict
from uuid import uuid4

from application.ports.training.evaluation_artifacts import EvaluationArtifacts
from application.use_cases.training.build_reward_datasets import REWARD_IDS
from application.use_cases.training.training_run import (
    ACTIVE_STATUSES, ArtifactConflict, ArtifactNotFound, utc_now,
)

from . import EvaluationMode
from .benchmark import BenchmarkConfig

logger = logging.getLogger(__name__)


class StartEvaluation:
    def __init__(self, store: EvaluationArtifacts, launch: Callable[[str], None]) -> None:
        self._store = store
        self._launch = launch

    def execute(
        self, benchmark: BenchmarkConfig, mode: EvaluationMode,
        adapters: dict[int, dict[str, str]], *, pilot_limit: int | None = None,
    ) -> dict:
        if mode == "official":
            if set(adapters) != set(benchmark.seeds) or pilot_limit is not None:
                raise ValueError("An official evaluation requires all frozen seeds and no question limit.")
        elif len(adapters) != 1 or not set(adapters).issubset(benchmark.seeds):
            raise ValueError("A validation pilot requires one of the benchmark seeds.")
        if any(set(runs) != set(REWARD_IDS) for runs in adapters.values()):
            raise ValueError("Each seed requires one completed run for each of R0–R3.")
        if pilot_limit is not None and pilot_limit < 1:
            raise ValueError("The pilot question limit must be positive.")

        with self._store.transaction():
            self._store.recover_interrupted()
            self._check_available()
            sources = {
                str(seed): {
                    reward: self._check_adapter(run_id, reward, seed, benchmark, mode)
                    for reward, run_id in sorted(adapters[seed].items())
                } for seed in sorted(adapters)
            }
            if mode == "official":
                runtimes = [item["training_runtime"] for runs in sources.values() for item in runs.values()]
                if any(runtime != runtimes[0] for runtime in runtimes[1:]):
                    raise ValueError("The official training runs must use the same runtime and hardware.")
            now = utc_now()
            record = {
                "id": str(uuid4()), "name": f"{benchmark.version} {mode}", "notes": "",
                "created_at": now, "updated_at": now, "status": "queued", "error": None,
                "mode": mode, "partition": benchmark.split_for(mode), "pilot_limit": pilot_limit,
                "benchmark": asdict(benchmark), "adapters": sources, "progress": {},
            }
            self._store.write("evaluations", record["id"], record)
            try:
                self._launch(record["id"])
            except Exception:
                logger.exception("Could not start evaluation worker for %s", record["id"])
                record.update(status="failed", error="Could not start the evaluation worker.", updated_at=utc_now())
                self._store.write("evaluations", record["id"], record)
            return record

    def _check_available(self) -> None:
        if self._store.compute_busy() or any(run["status"] in ACTIVE_STATUSES for run in (
            self._store.list_artifacts("runs") + self._store.list_artifacts("evaluations")
        )):
            raise ArtifactConflict("Training or evaluation is already active.")

    def _check_adapter(
        self, run_id: str, reward: str, seed: int, benchmark: BenchmarkConfig, mode: EvaluationMode,
    ) -> dict:
        run = self._store.get("runs", run_id)
        if run["status"] != "completed" or run["reward"] != reward:
            raise ValueError(f"{run_id} must be a completed {reward.upper()} adapter.")
        if (run["model_id"], run["model_revision"]) != (benchmark.model_id, benchmark.model_revision):
            raise ValueError(f"{run_id} used a different base checkpoint.")
        provenance = run.get("dataset_provenance")
        if not provenance:
            try:
                dataset = self._store.get("datasets", run["dataset_id"])
            except ArtifactNotFound as error:
                raise ValueError(f"{run_id} lacks saved training provenance. Rebuild and train it again.") from error
            if dataset["dataset_sha256"] != run["dataset_sha256"]:
                raise ValueError(f"{run_id} does not match its source dataset hash.")
            provenance = dataset["provenance"]
        if provenance.get("partition") != "train" or provenance.get("corpus_sha256") != benchmark.corpus_sha256:
            raise ValueError(f"{run_id} must be trained on the benchmark corpus's training partition.")
        expected_split = asdict(benchmark.split)
        saved_split = provenance.get("split", {})
        if any(sorted(saved_split.get(key, ())) != sorted(ids) for key, ids in expected_split.items()):
            raise ValueError(f"{run_id} has a different conversation split.")
        if set(provenance.get("train_conversation_ids", ())) != set(benchmark.split.train_conversation_ids):
            raise ValueError(f"{run_id} has different training conversations.")
        if run["settings"]["seed"] != seed or provenance.get("settings", {}).get("seed") != seed:
            raise ValueError(f"{run_id} used a different dataset build or training seed.")
        if mode == "official":
            self._check_frozen_inputs(run, provenance, benchmark, seed)
        actual = self._store.adapter_digest(run_id)
        if run.get("adapter_sha256") and actual != run["adapter_sha256"]:
            raise ValueError(f"{run_id} adapter files do not match their recorded hashes.")
        return {"run_id": run_id, "dataset_id": run["dataset_id"], "dataset_sha256": run["dataset_sha256"],
                "adapter_sha256": actual, "model_id": run["model_id"], "model_revision": run["model_revision"],
                "training_settings": run["settings"], "training_runtime": run.get("runtime", {}),
                "dataset_provenance": provenance}

    @staticmethod
    def _check_frozen_inputs(run: dict, provenance: dict, benchmark: BenchmarkConfig, seed: int) -> None:
        run_id = run["id"]
        expected = {**benchmark.embedding, "categories": list(benchmark.categories),
                    "model_id": benchmark.model_id, "model_revision": benchmark.model_revision,
                    "reward_pipeline_version": benchmark.reward_pipeline_version,
                    "rewrite_prompt_version": benchmark.rewrite_prompt_version}
        if any(provenance.get(key) != value for key, value in expected.items()):
            raise ValueError(f"{run_id} has different benchmark build provenance.")
        if any(key not in provenance["settings"] or provenance["settings"][key] != value
               for key, value in benchmark.build.items()):
            raise ValueError(f"{run_id} used non-benchmark reward settings.")
        if run["settings"] != asdict(benchmark.training_settings(seed)):
            raise ValueError(f"{run_id} used non-benchmark fine-tuning settings.")
        runtime = run.get("runtime", {})
        for key in ("training_device", "base_weight_dtype", "mixed_precision"):
            if runtime.get(key) != benchmark.hardware[key]:
                raise ValueError(f"{run_id} does not record the frozen training device and precision.")
        peak = run.get("metrics", {}).get("peak_device_memory_bytes")
        budget = benchmark.hardware["target_vram_gib"] * 1024**3
        if peak is None or peak > budget:
            raise ValueError(f"{run_id} does not demonstrate a fit within the benchmark VRAM target.")
