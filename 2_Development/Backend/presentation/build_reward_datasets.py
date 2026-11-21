import argparse
import json
from dataclasses import asdict
from hashlib import file_digest, sha256
from os import getenv
from pathlib import Path
from tempfile import TemporaryDirectory

from application.use_cases.dataset import (
    CreateDatasetSplit, IndexDataset, LoadDataset, PrepareDataset,
)
from application.use_cases.generation.rewrite_query import REWRITE_PROMPT_VERSION
from application.use_cases.training.build_reward_dataset import (
    RewardBuildSettings,
    RewardDataset,
)
from application.use_cases.training.build_reward_datasets import (
    REWARD_IDS, REWARD_PIPELINE_VERSION, BuildRewardDatasets,
)
from infrastructure.config import config
from infrastructure.dataset.locomo_adapter import LoCoMoAdapter
from infrastructure.memory_store import QdrantAdapter
from infrastructure.models.embedding import BGEAdapter
from infrastructure.models.llm import TransformersLLMAdapter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build rewrite datasets from LoCoMo's training split.")
    defaults = RewardBuildSettings()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="New output directory.")
    parser.add_argument("--train-size", type=int, required=True)
    parser.add_argument("--validation-size", type=int, required=True)
    parser.add_argument("--test-size", type=int, required=True)
    parser.add_argument("--split-seed", type=int, default=config.dataset_split_seed)
    parser.add_argument("--seed", type=int, default=defaults.seed)
    parser.add_argument(
        "--rewards", nargs="+", choices=REWARD_IDS, default=REWARD_IDS
    )
    parser.add_argument("--candidates", type=int, default=defaults.candidates)
    parser.add_argument("--temperature", type=float, default=defaults.temperature)
    parser.add_argument("--rewrite-max-tokens", type=int, default=defaults.rewrite_max_tokens)
    parser.add_argument("--top-k", type=int, default=defaults.top_k)
    parser.add_argument("--token-budget", type=int, default=defaults.token_budget)
    parser.add_argument("--max-inputs-per-reward", type=int)
    parser.add_argument("--model-id", default=config.llm_model_id)
    parser.add_argument("--model-revision", help="Explicit checkpoint revision for a custom model.")
    args = parser.parse_args()
    if args.train_size < 1:
        parser.error("--train-size must be positive.")
    if args.model_revision is None:
        if args.model_id != config.llm_model_id:
            parser.error("--model-revision is required with a custom model.")
        args.model_revision = config.llm_model_revision
    if args.output.exists():
        parser.error("--output must point to a new directory.")
    return args


def write_datasets(output: Path, datasets: dict[str, RewardDataset], manifest: dict) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".reward-build-", dir=output.parent) as temporary:
        staging = Path(temporary) / "result"
        staging.mkdir()
        for reward, dataset in datasets.items():
            for name, rows in (
                (f"{reward}.jsonl", dataset.examples),
                (f"{reward}.diagnostics.jsonl", dataset.outcomes),
            ):
                with (staging / name).open("w", encoding="utf-8") as stream:
                    for row in rows:
                        stream.write(json.dumps(asdict(row), ensure_ascii=False) + "\n")
        (staging / "manifest.json").write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        if output.exists():
            raise FileExistsError(f"Output directory already exists: {output}")
        staging.rename(output)


def main() -> None:
    args = parse_args()
    settings = RewardBuildSettings(
        seed=args.seed,
        candidates=args.candidates,
        temperature=args.temperature,
        rewrite_max_tokens=args.rewrite_max_tokens,
        top_k=args.top_k,
        token_budget=args.token_budget,
        max_inputs_per_reward=args.max_inputs_per_reward,
    )
    with args.dataset.open("rb") as source:
        corpus_sha = file_digest(source, "sha256").hexdigest()
    dataset = LoadDataset(LoCoMoAdapter(args.dataset)).execute()
    split = CreateDatasetSplit().execute(
        dataset.conversation_ids,
        args.train_size,
        args.validation_size,
        args.test_size,
        seed=args.split_seed,
    )
    train = PrepareDataset().execute(dataset, split).train
    BuildRewardDatasets.validate_inputs(train, args.rewards)

    index_settings = {
        "corpus_sha256": corpus_sha,
        "train_conversation_ids": sorted(split.train_conversation_ids),
        "embedding_model": config.embedding_model,
        "embedding_revision": config.embedding_revision,
        "embedding_max_length": config.embedding_max_length,
        "memory_format_version": 1,
    }
    index_key = sha256(json.dumps(index_settings, sort_keys=True).encode()).hexdigest()
    collection = f"{config.qdrant_collection}_train_{index_key[:24]}"

    llm = TransformersLLMAdapter(args.model_id, revision=args.model_revision)

    embedder = BGEAdapter()
    store = QdrantAdapter.from_config(embedder.vector_size, collection_name=collection)
    try:
        store.ensure_collection()
        print(
            f"Indexing {len(train.conversations)} training conversations into {collection}.",
            flush=True,
        )
        indexed = IndexDataset(embedder, store).execute(
            train.conversations, batch_size=config.index_batch_size
        )
        if not indexed:
            raise ValueError("The training partition contains no turns to index.")
        print(f"Scoring rewrites for {', '.join(args.rewards)}.", flush=True)
        datasets = BuildRewardDatasets(llm, llm, llm, embedder, store).execute(
            train, args.rewards, settings
        )
    finally:
        store.client.close()

    summary = {reward: result.summary() for reward, result in datasets.items()}
    write_datasets(args.output, datasets, {
        **index_settings,
        "dataset": str(args.dataset),
        "split": asdict(split),
        "split_seed": args.split_seed,
        "model_id": args.model_id,
        "model_revision": args.model_revision,
        "device": getenv("LLM_DEVICE", "cpu"),
        "embedding_device": config.embedding_device,
        "embedding_query_instruction": config.embedding_query_instruction,
        "reward_pipeline_version": REWARD_PIPELINE_VERSION,
        "rewrite_prompt_version": REWRITE_PROMPT_VERSION,
        "settings": asdict(settings),
        "collection": collection,
        "indexed_memories": indexed,
        "rewards": summary,
    })
    print(json.dumps(summary, indent=2))
    print(f"Wrote reward datasets to {args.output}.")


if __name__ == "__main__":
    main()
