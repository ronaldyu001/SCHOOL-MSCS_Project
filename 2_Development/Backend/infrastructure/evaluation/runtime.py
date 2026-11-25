import json
from contextlib import contextmanager
from dataclasses import replace
from hashlib import sha256
from pathlib import Path

from application.use_cases.dataset import IndexDataset, LoadDataset, PrepareDataset
from application.use_cases.dataset.index_dataset import MEMORY_FORMAT_VERSION
from application.use_cases.evaluation.benchmark import BenchmarkConfig
from application.use_cases.generation.rewrite_query import REWRITE_PROMPT_VERSION
from application.use_cases.training.build_reward_datasets import REWARD_PIPELINE_VERSION
from domain.entities import DatasetPartition
from infrastructure.config import config
from infrastructure.dataset.locomo_adapter import LoCoMoAdapter
from infrastructure.memory_store.qdrant_adapter import QdrantAdapter
from infrastructure.models.embedding.bge_adapter import BGEAdapter


def load_benchmark() -> BenchmarkConfig:
    return BenchmarkConfig.from_dict(json.loads(config.benchmark_config.read_text(encoding="utf-8")))


def prepare_benchmark(benchmark: BenchmarkConfig):
    if (
        benchmark.rewrite_prompt_version != REWRITE_PROMPT_VERSION
        or benchmark.reward_pipeline_version != REWARD_PIPELINE_VERSION
        or benchmark.embedding.get("memory_format_version") != MEMORY_FORMAT_VERSION
    ):
        raise ValueError("The benchmark config targets different pipeline versions.")
    if Path(benchmark.model_id).is_dir():
        raise ValueError("The benchmark model must be a Hugging Face Hub model.")
    source = LoCoMoAdapter(config.benchmark_dataset)
    dataset = LoadDataset(source).execute()
    if source.corpus_sha256 != benchmark.corpus_sha256:
        raise ValueError("The mounted LoCoMo corpus does not match the benchmark hash.")
    return PrepareDataset().execute(dataset, benchmark.split, benchmark.categories)


@contextmanager
def benchmark_index(benchmark: BenchmarkConfig, partition: DatasetPartition, name: str):
    embedding_settings = {
        key: value for key, value in benchmark.embedding.items() if key != "memory_format_version"
    }
    embedder = BGEAdapter(replace(config, **embedding_settings))
    identity = {
        "corpus_sha256": benchmark.corpus_sha256,
        "conversation_ids": sorted(item.id for item in partition.conversations),
        **benchmark.embedding,
    }
    key = sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:24]
    collection = f"{config.qdrant_collection}_benchmark_{name}_{key}"
    store = QdrantAdapter.from_config(embedder.vector_size, collection_name=collection)
    try:
        store.ensure_collection()
        expected = sum(len(session.turns) for item in partition.conversations for session in item.sessions)
        if expected < 1:
            raise ValueError("The benchmark partition has no memory turns.")
        if store.client.count(collection_name=collection, exact=True).count != expected:
            IndexDataset(embedder, store).execute(partition.conversations, batch_size=config.index_batch_size)
            if store.client.count(collection_name=collection, exact=True).count != expected:
                raise ValueError("The benchmark collection does not contain the expected memory turns.")
        yield embedder, store
    finally:
        store.client.close()
