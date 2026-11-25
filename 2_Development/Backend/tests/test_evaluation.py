import json
from contextlib import nullcontext
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase
from uuid import uuid4

from application.use_cases.evaluation.benchmark import BenchmarkConfig
from application.use_cases.evaluation.evaluate_rewriters import EvaluateRewriters, evaluation_questions
from application.use_cases.evaluation.start_evaluation import StartEvaluation
from application.use_cases.evaluation.summarize import summarize
from application.use_cases.retrieval import BuildContext, RetrieveMemories
from application.use_cases.retrieval.search_memories import SearchMemories
from application.use_cases.training.training_run import ArtifactConflict
from domain.entities import Conversation, DatasetPartition, QA, Session, Turn
from infrastructure.training.artifact_store import FileArtifactStore


def benchmark_config() -> BenchmarkConfig:
    path = Path(__file__).resolve().parents[1] / "infrastructure/benchmarks/locomo-signal-v1.json"
    return BenchmarkConfig.from_dict(json.loads(path.read_text(encoding="utf-8")))


class EvaluationMetricsTest(TestCase):
    def test_one_question_keeps_ties_and_uses_evidence_inside_each_budget(self):
        benchmark = benchmark_config()
        partition = DatasetPartition(
            conversations=(Conversation(
                id="test", speakers=("A", "B"),
                sessions=(Session(id=1, timestamp=datetime(2025, 1, 1),
                                  turns=(Turn("e1", "A", "evidence"),)),),
            ),),
            qa=(QA("q1", "test", "query", "single_hop", evidence_turn_ids=("e1; e1",)),
                QA("q2", "test", "unknown", "multi_hop", evidence_turn_ids=("missing",))),
        )
        questions, excluded = evaluation_questions(partition)

        def embed(queries):
            return [(1.0,) if text.startswith("[") or text == "good" else (0.0,) for text in queries]

        def search(vector, *_args, **_kwargs):
            noise = SimpleNamespace(memory=SimpleNamespace(text="n" * 128, source_turn_ids=("noise",)))
            hit = SimpleNamespace(memory=SimpleNamespace(text="gold", source_turn_ids=("e1",)))
            return [noise, hit] if vector == (1.0,) else [noise]

        def load(run_id):
            return nullcontext(SimpleNamespace(generate=lambda *_args, **_kwargs: (
                "good" if run_id in {"r0", "r1"} else ""
            )))

        harness = SearchMemories(
            RetrieveMemories(SimpleNamespace(embed_queries=embed), SimpleNamespace(search=search)),
            BuildContext(len),
        )
        rows = list(EvaluateRewriters(harness, load).execute(
            questions, benchmark, {123: {r: r for r in ("r0", "r1", "r2", "r3")}}, lambda _: None,
        ))
        report = summarize(rows, excluded)
        self.assertEqual(len(rows), 7 * len(benchmark.token_budgets))
        self.assertEqual(report["excluded_questions"], {"multi_hop": {"unresolved_evidence": 1}})
        by_key = {(row["variant"], row["budget"]): row for row in report["per_seed"]
                  if row["category"] == "single_hop"}
        self.assertEqual(by_key["r0", 128]["mean_recall"], 0)
        self.assertIsNone(by_key["r0", 128]["mean_first_hit_rank"])
        self.assertEqual(by_key["r0", 256]["mean_recall"], 1)
        self.assertEqual(by_key["r0", 256]["mean_first_hit_rank"], 2)
        self.assertEqual(by_key["r2", 256]["blank_rewrites"], 1)
        self.assertEqual(by_key["best_of_three", 256]["mean_recall"], 1)
        self.assertEqual(by_key["r1", 256]["r0_gain_recovered"], 1)
        self.assertIsNone(by_key["r1", 128]["r0_gain_recovered"])
        headroom = summarize(
            (row for row in rows if row["variant"] in {"raw", "prompted", "gold_query"}),
            excluded, headroom_only=True,
        )
        self.assertEqual({row["variant"] for row in headroom["curves"]}, {"raw", "prompted", "gold_query"})

    def test_wrong_partition_and_active_worker_cannot_queue(self):
        benchmark = benchmark_config()
        with TemporaryDirectory() as temporary:
            store = FileArtifactStore(Path(temporary))
            launcher = StartEvaluation(store, lambda _: self.fail("An invalid run was launched."))
            with self.assertRaisesRegex(ValueError, "all frozen seeds"):
                launcher.execute(benchmark, "official", {123: {}})
            with self.assertRaisesRegex(ValueError, "one completed run"):
                launcher.execute(benchmark, "pilot", {123: {"r0": "wrong"}})
            run_ids = {r: f"01234567-89ab-4cde-8fab-0123456789a{i}" for i, r in enumerate(("r0", "r1", "r2", "r3"))}
            with store.transaction():
                store.write("runs", run_ids["r0"], {
                    "id": run_ids["r0"], "status": "completed", "reward": "r0",
                    "model_id": benchmark.model_id, "model_revision": benchmark.model_revision,
                    "dataset_provenance": {"partition": "test", "corpus_sha256": benchmark.corpus_sha256},
                    "created_at": "2025-01-01",
                })
            with self.assertRaisesRegex(ValueError, "training partition"):
                launcher.execute(benchmark, "pilot", {123: run_ids})
            with store.open_worker_lock(), self.assertRaises(ArtifactConflict):
                launcher.execute(benchmark, "pilot", {123: run_ids})

    def test_official_queue_checks_paired_seeds_and_observed_hardware(self):
        benchmark = benchmark_config()
        with TemporaryDirectory() as temporary:
            store = FileArtifactStore(Path(temporary))
            runs = {}
            runtime = {"training_device": "cuda", "base_weight_dtype": "float32",
                       "mixed_precision": "bfloat16", "gpu_name": "test GPU"}
            for seed in benchmark.seeds:
                runs[seed] = {}
                for reward in ("r0", "r1", "r2", "r3"):
                    run_id = str(uuid4())
                    runs[seed][reward] = run_id
                    folder = store.adapter_directory(run_id)
                    folder.mkdir(parents=True)
                    (folder / "adapter_config.json").write_text("{}", encoding="utf-8")
                    (folder / "adapter_model.safetensors").write_bytes(b"sample adapter")
                    store.write("runs", run_id, {
                        "id": run_id, "status": "completed", "reward": reward,
                        "model_id": benchmark.model_id, "model_revision": benchmark.model_revision,
                        "dataset_id": str(uuid4()), "dataset_sha256": "a" * 64, "runtime": runtime,
                        "settings": asdict(benchmark.training_settings(seed)), "created_at": "2025-01-01",
                        "dataset_provenance": {
                            "partition": "train", "corpus_sha256": benchmark.corpus_sha256,
                            "split": asdict(benchmark.split), "settings": {"seed": seed, **benchmark.build},
                            "train_conversation_ids": benchmark.split.train_conversation_ids,
                            "categories": list(benchmark.categories), **benchmark.embedding,
                            "model_id": benchmark.model_id, "model_revision": benchmark.model_revision,
                            "reward_pipeline_version": benchmark.reward_pipeline_version,
                            "rewrite_prompt_version": benchmark.rewrite_prompt_version,
                        },
                        "metrics": {"peak_device_memory_bytes": 4 * 1024**3},
                    })
            launched = []
            launcher = StartEvaluation(store, launched.append)
            record = store.get("runs", run_id)
            record["runtime"] = {**runtime, "gpu_name": "different GPU"}
            store.write("runs", run_id, record)
            with self.assertRaisesRegex(ValueError, "same runtime and hardware"):
                launcher.execute(benchmark, "official", runs)
            self.assertEqual(launched, [])
            record["runtime"] = runtime
            store.write("runs", run_id, record)
            evaluation = launcher.execute(benchmark, "official", runs)
            self.assertEqual(evaluation["partition"], "test")
            self.assertEqual(launched, [evaluation["id"]])
