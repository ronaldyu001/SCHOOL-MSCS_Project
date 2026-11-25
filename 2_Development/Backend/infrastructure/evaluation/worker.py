import json
import os
import sys
from collections.abc import Callable, Iterable
from contextlib import contextmanager
from pathlib import Path

from application.use_cases.evaluation.benchmark import BenchmarkConfig
from application.use_cases.evaluation.evaluate_rewriters import EvaluateRewriters, evaluation_questions
from application.use_cases.evaluation.run_evaluation import RunEvaluation
from application.use_cases.retrieval import BuildContext, RetrieveMemories
from application.use_cases.retrieval.search_memories import SearchMemories
from infrastructure.config import config
from infrastructure.models.llm.runtime import describe_runtime
from infrastructure.models.llm.transformers_llm_adapter import TransformersLLMAdapter
from infrastructure.training.artifact_store import FileArtifactStore

from .runtime import benchmark_index, prepare_benchmark


class BenchmarkEvaluator:
    def __init__(self, store: FileArtifactStore) -> None:
        self._store = store

    def execute(
        self, record: dict, benchmark: BenchmarkConfig, report: Callable[[dict], None],
    ) -> tuple[Iterable[dict], dict, dict]:
        from transformers import AutoTokenizer

        report({"phase": "preparing", "partition": record["partition"]})
        partition = getattr(prepare_benchmark(benchmark), record["partition"])
        questions, excluded = evaluation_questions(partition)
        limit = record["pilot_limit"]
        if limit is not None:
            questions = questions[:limit]
        device = benchmark.hardware["training_device"] if record["mode"] == "official" else (
            "cuda" if config.training_device in {"gpu", "cuda"} else "cpu"
        )
        runtime = describe_runtime(device, mixed_precision="none")
        runtime["evaluation_device"] = runtime.pop("training_device")
        tokenizer = AutoTokenizer.from_pretrained(
            benchmark.model_id, revision=benchmark.model_revision, trust_remote_code=False,
        )
        sources = {
            source["run_id"]: source
            for seed in record["adapters"].values() for source in seed.values()
        }
        adapters = {int(seed): {reward: source["run_id"] for reward, source in runs.items()}
                    for seed, runs in record["adapters"].items()}

        @contextmanager
        def load_rewriter(run_id: str | None):
            adapter_path = None
            if run_id is not None:
                if self._store.adapter_digest(run_id) != sources[run_id]["adapter_sha256"]:
                    raise ValueError(f"Adapter {run_id} changed since the evaluation was queued.")
                adapter_path = self._store.adapter_directory(run_id)
                metadata = json.loads((adapter_path / "adapter_config.json").read_text(encoding="utf-8"))
                if (metadata["base_model_name_or_path"], metadata.get("revision")) != (
                    benchmark.model_id, benchmark.model_revision,
                ):
                    raise ValueError(f"Adapter {run_id} is not pinned to the benchmark base checkpoint.")
            yield TransformersLLMAdapter(
                benchmark.model_id, revision=benchmark.model_revision, device=device,
                adapter_path=adapter_path, dtype="float32",
            )

        def evaluate_rows():
            report({"phase": "indexing", "partition": record["partition"]})
            with benchmark_index(benchmark, partition, record["partition"]) as (embedder, memory):
                runtime["collection"] = memory.collection_name
                search = SearchMemories(
                    RetrieveMemories(embedder, memory),
                    BuildContext(lambda text: len(tokenizer.encode(text, add_special_tokens=False, verbose=False))),
                )
                yield from EvaluateRewriters(search, load_rewriter).execute(questions, benchmark, adapters, report)

        return evaluate_rows(), excluded, runtime


def main() -> None:
    root, run_id, descriptor = sys.argv[1:]
    with os.fdopen(int(descriptor), "rb"):
        store = FileArtifactStore(Path(root))
        RunEvaluation(store, BenchmarkEvaluator(store).execute).execute(run_id)


if __name__ == "__main__":
    main()
