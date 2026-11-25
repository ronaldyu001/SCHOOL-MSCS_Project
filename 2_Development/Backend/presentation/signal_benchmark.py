"""Build, train, and evaluate the frozen signal benchmark from Docker."""

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path
from time import sleep

from application.use_cases.evaluation.start_evaluation import StartEvaluation
from application.use_cases.evaluation.summarize import summarize
from application.use_cases.training.build_reward_datasets import REWARD_IDS, BuildRewardDatasets
from application.use_cases.training.manage_artifacts import ReadArtifacts, SaveRewardDatasets
from application.use_cases.training.train_rewrite_adapter import StartTrainingRun
from application.use_cases.training.training_run import ArtifactKind
from infrastructure.config import config
from infrastructure.evaluation.runtime import benchmark_index, load_benchmark, prepare_benchmark
from infrastructure.evaluation.worker import BenchmarkEvaluator
from infrastructure.models.llm.transformers_llm_adapter import TransformersLLMAdapter
from infrastructure.training.artifact_store import FileArtifactStore
from infrastructure.training.worker import SubprocessTrainingWorker


def build_datasets(store: FileArtifactStore, seed: int, limit: int | None) -> dict[str, str]:
    benchmark = load_benchmark()
    partition = prepare_benchmark(benchmark).train
    settings = benchmark.reward_settings(seed, limit)
    with store.transaction():
        store.recover_interrupted()
        lease = store.open_worker_lock()
    device = "cuda" if config.training_device in {"cuda", "gpu"} else "cpu"
    with lease, benchmark_index(benchmark, partition, "train") as (embedder, memory):
        model = TransformersLLMAdapter(benchmark.model_id, revision=benchmark.model_revision, device=device)
        options = {key: benchmark.build[key] for key in ("answer_max_tokens", "r2_prior_turns", "r3_max_tokens")}
        datasets = BuildRewardDatasets(model, model, model, embedder, memory).execute(
            partition, REWARD_IDS, settings, **options,
            report_progress=lambda reward, count: print(f"{reward} {count} attempted", file=sys.stderr)
            if count % 100 == 0 else None,
        )
        records = SaveRewardDatasets(store).execute(datasets, {
            "source": "benchmark", "partition": "train", "corpus_sha256": benchmark.corpus_sha256,
            "split": asdict(benchmark.split), "split_seed": benchmark.split_seed,
            "train_conversation_ids": list(benchmark.split.train_conversation_ids),
            "categories": list(benchmark.categories), **benchmark.embedding,
            "model_id": benchmark.model_id, "model_revision": model.resolved_revision,
            "rewrite_prompt_version": benchmark.rewrite_prompt_version,
            "reward_pipeline_version": benchmark.reward_pipeline_version,
            "settings": {**asdict(settings), **options}, "collection": memory.collection_name,
        })
    return {reward: item["id"] for reward, item in records.items()}


def wait_for_run(store: FileArtifactStore, kind: ArtifactKind, run_id: str) -> dict:
    while True:
        record = ReadArtifacts(store).execute(kind, run_id)
        if record["status"] == "completed" and not store.compute_busy():
            return record
        if record["status"] in {"failed", "interrupted"}:
            raise ValueError(f"{run_id}: {record['error']}")
        sleep(2)


def train_datasets(
    store: FileArtifactStore, worker: SubprocessTrainingWorker, seed: int,
    datasets: dict[str, str],
) -> dict[str, str]:
    if set(datasets) != set(REWARD_IDS):
        raise ValueError("Supply one saved dataset ID for each of R0–R3.")
    benchmark = load_benchmark()
    device = "cuda" if config.training_device in {"cuda", "gpu"} else "cpu"
    start = StartTrainingRun(
        store, worker, default_checkpoint=(benchmark.model_id, benchmark.model_revision),
        # Training uses the pinned benchmark checkpoint, which is checked by prepare_benchmark.
        validate_model_id=lambda _: None,
    )
    prepare_benchmark(benchmark)
    results = {}
    for reward in REWARD_IDS:
        dataset = ReadArtifacts(store).execute("datasets", datasets[reward])
        provenance = dataset["provenance"]
        split = asdict(benchmark.split)
        if (dataset["reward"] != reward or provenance.get("partition") != "train"
                or provenance.get("settings", {}).get("seed") != seed
                or provenance.get("corpus_sha256") != benchmark.corpus_sha256
                or any(sorted(provenance.get("split", {}).get(key, ())) != sorted(ids)
                       for key, ids in split.items())
                or (provenance.get("model_id"), provenance.get("model_revision"))
                != (benchmark.model_id, benchmark.model_revision)):
            raise ValueError(f"Dataset {datasets[reward]} does not match {reward} and benchmark seed {seed}.")
    for reward in REWARD_IDS:
        run = start.execute(
            datasets[reward], model_id=benchmark.model_id, revision=benchmark.model_revision,
            device=device, settings=benchmark.training_settings(seed), name=f"{reward.upper()} seed {seed}",
            notes="Frozen signal benchmark.",
        )
        print(f"Started {reward} seed {seed}: {run['id']}", file=sys.stderr)
        results[reward] = wait_for_run(store, "runs", run["id"])["id"]
    return results


def measure_headroom(store: FileArtifactStore, limit: int | None) -> dict:
    benchmark = load_benchmark()
    record = {"partition": "validation", "mode": "pilot", "pilot_limit": limit,
              "adapters": {str(benchmark.seeds[0]): {}}}
    with store.transaction():
        store.recover_interrupted()
        lease = store.open_worker_lock()
    with lease:
        rows, excluded, runtime = BenchmarkEvaluator(store).execute(record, benchmark, lambda _: None)
        return {"benchmark": asdict(benchmark), "partition": "validation", "runtime": runtime,
                **summarize(rows, excluded, headroom_only=True)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    headroom = commands.add_parser("headroom")
    headroom.add_argument("--limit", type=int, help="Optional validation question limit.")
    build = commands.add_parser("build")
    build.add_argument("--seed", type=int, required=True)
    build.add_argument("--limit", type=int, help="Optional capped reward build for a validation pilot.")
    train = commands.add_parser("train")
    train.add_argument("--seed", type=int, required=True)
    train.add_argument("--datasets", type=Path, required=True, help="JSON map from reward to dataset ID.")
    evaluate = commands.add_parser("evaluate")
    evaluate.add_argument("--adapters", type=Path, required=True, help="JSON map from seed to reward to run ID.")
    evaluate.add_argument("--mode", choices=("pilot", "official"), default="official")
    evaluate.add_argument("--limit", type=int, help="Optional validation pilot question limit.")
    for command in (headroom, build, train, evaluate):
        command.add_argument("--output", type=Path, help="Write the command's JSON output to a new file.")
    args = parser.parse_args()
    if getattr(args, "limit", None) is not None and args.limit < 1:
        parser.error("--limit must be positive.")
    if args.output is not None and args.output.exists():
        parser.error("--output must point to a new file.")
    benchmark = load_benchmark()
    if hasattr(args, "seed") and args.seed not in benchmark.seeds:
        parser.error(f"Choose one of the frozen seeds: {benchmark.seeds}")
    store = FileArtifactStore(config.artifacts_dir)
    worker = SubprocessTrainingWorker(store)
    try:
        if args.command == "headroom":
            output = measure_headroom(store, args.limit)
        elif args.command == "build":
            output = build_datasets(store, args.seed, args.limit)
        elif args.command == "train":
            output = train_datasets(store, worker, args.seed, json.loads(args.datasets.read_text(encoding="utf-8")))
        else:
            payload = json.loads(args.adapters.read_text(encoding="utf-8"))
            run = StartEvaluation(store, worker.launch_evaluation).execute(
                benchmark, args.mode, {int(seed): runs for seed, runs in payload.items()}, pilot_limit=args.limit,
            )
            print(f"Started evaluation: {run['id']}", file=sys.stderr)
            result = wait_for_run(store, "evaluations", run["id"])
            output = {"id": result["id"], "status": result["status"], "partition": result["partition"]}
        serialized = json.dumps(output, indent=2) + "\n"
        if args.output is not None:
            with args.output.open("x", encoding="utf-8") as stream:
                stream.write(serialized)
        else:
            print(serialized, end="")
    finally:
        worker.close()


if __name__ == "__main__":
    main()
