"""Versioned application defaults and deployment-specific service URLs."""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# Resolve against the backend directory, independent of the launch directory.
# Exported environment variables take precedence over the local .env file.
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)


@dataclass(frozen=True)
class Config:
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
    cors_allow_methods: tuple = ("GET", "POST")
    cors_allow_headers: tuple = ("Content-Type",)
    frontend_url: str = field(
        default_factory=lambda: os.environ.get("FRONTEND_URL", "http://localhost:5173")
    )
    qdrant_url: str = field(
        default_factory=lambda: os.environ.get("QDRANT_URL", "http://localhost:6333")
    )


config = Config()
