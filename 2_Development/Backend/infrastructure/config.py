"""Versioned application defaults and deployment-specific service URLs."""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

from application.use_cases.training.training_run import TrainingSettings

# Resolve against the backend directory, independent of the launch directory.
# Exported environment variables take precedence over the local .env file.
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)


@dataclass(frozen=True)
class Config:
    llm_model_id: str = "Qwen/Qwen2.5-0.5B"
    llm_model_revision: str = "060db6499f32faf8b98477b0a26969ef7d8b9987"
    training_defaults: TrainingSettings = field(default_factory=TrainingSettings)
    training_device: str = field(default_factory=lambda: os.environ.get("LLM_DEVICE", "auto"))
    artifacts_dir: Path = field(
        default_factory=lambda: Path(os.environ.get("ARTIFACTS_DIR", "/artifacts"))
    )
    dataset_dir: Path = field(
        default_factory=lambda: Path(os.environ.get("DATASET_DIR", "/data"))
    )
    benchmark_config: Path = field(default_factory=lambda: Path(os.environ.get(
        "BENCHMARK_CONFIG", str(Path(__file__).resolve().parent / "benchmarks" / "locomo-signal-v1.json")
    )))
    benchmark_dataset: Path = field(
        default_factory=lambda: Path(os.environ.get(
            "BENCHMARK_DATASET", str(Path(os.environ.get("DATASET_DIR", "/data")) / "locomo10.json")
        ))
    )
    embedding_model: str = "BAAI/bge-base-en-v1.5"
    embedding_revision: str = "a5beb1e3e68b9ab74eb54cfd186867f64f240e1a"
    embedding_device: str = "cpu"
    index_batch_size: int = 64
    embedding_batch_size: int = 32
    embedding_max_length: int = 512
    embedding_query_instruction: str = "Represent this sentence for searching relevant passages: "
    api_title: str = "Memory Rewriter API"
    dataset_split_seed: int = 123
    qdrant_collection: str = "memories"
    cors_allow_methods: tuple = ("GET", "POST", "PATCH", "DELETE")
    cors_allow_headers: tuple = ("Content-Type",)
    frontend_url: str = field(
        default_factory=lambda: os.environ.get("FRONTEND_URL", "http://localhost:5173")
    )
    qdrant_url: str = field(
        default_factory=lambda: os.environ.get("QDRANT_URL", "http://localhost:6333")
    )


config = Config()
