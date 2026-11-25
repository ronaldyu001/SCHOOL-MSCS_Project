"""Reuse indexes only when durable provenance and Qdrant contents agree."""
import hashlib
import json
import logging

from application.use_cases.dataset.index_dataset import MEMORY_FORMAT_VERSION
from infrastructure.config import config
from infrastructure.memory_store.qdrant_adapter import QdrantAdapter

logger = logging.getLogger(__name__)


def index_provenance(state, dataset_id: str) -> dict:
    corpus = getattr(state, "corpus_hashes", {}).get(dataset_id)
    if not corpus:
        raise ValueError("Dataset corpus fingerprint is missing. Reload the dataset.")
    return {
        "corpus_sha256": corpus,
        "collection": config.qdrant_collection,
        "embedding_model": config.embedding_model,
        "embedding_revision": config.embedding_revision,
        "embedding_max_length": config.embedding_max_length,
        "embedding_query_instruction": config.embedding_query_instruction,
        "memory_format_version": MEMORY_FORMAT_VERSION,
        "normalize_embeddings": True,
        "document_prompt": "",
    }


def index_signature(state, dataset_id: str) -> str:
    provenance = index_provenance(state, dataset_id)
    return hashlib.sha256(json.dumps(provenance, sort_keys=True).encode()).hexdigest()


def verify_conversation(state, dataset_id, conversation, store=None) -> bool:
    records = getattr(state, "index_records", {})
    record = records.get(conversation.id)
    owners = getattr(state, "indexed_conversation_owners", {})
    state.indexed_conversation_owners = owners
    owners.pop(conversation.id, None)
    if not record or record["dataset_id"] != dataset_id:
        return False
    if record["signature"] != index_signature(state, dataset_id):
        return False
    owned = store is None
    try:
        if owned:
            store = QdrantAdapter.from_config(record["vector_size"])
        if not store.index_matches(conversation, record["signature"]):
            return False
        owners[conversation.id] = dataset_id
        return True
    finally:
        if owned and store is not None:
            store.client.close()


def restore_index_ownership(state):
    for conversation_id, record in getattr(state, "index_records", {}).items():
        dataset = getattr(state, "datasets", {}).get(record["dataset_id"])
        if dataset is None:
            continue
        conversation = next((item for item in dataset.conversations if item.id == conversation_id), None)
        if conversation is not None:
            try:
                verify_conversation(state, record["dataset_id"], conversation)
            except Exception:
                logger.warning("Could not verify restored index for %s; it will be retried on use.", conversation_id, exc_info=True)
