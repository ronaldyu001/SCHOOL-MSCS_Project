import logging
from dataclasses import asdict
from pathlib import Path
from threading import Lock
from typing import Dict, List, Literal, Optional, Tuple
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from application.use_cases.dataset import CreateDatasetSplit, IndexDataset, LoadDataset, PrepareDataset
from application.use_cases.dataset.list_questions import ListQuestions
from domain.entities import Dataset, DatasetPartition, DatasetSplit, PreparedDataset, QACategory
from infrastructure.dataset.locomo_adapter import LoCoMoAdapter
from infrastructure.config import config

from .resources import memory_resources

router = APIRouter(prefix="/data", tags=["data"])
logger = logging.getLogger(__name__)
memory_index_lock = Lock()


class LoadDatasetRequest(BaseModel):
    path: str = Field(min_length=1)


class CreateSplitRequest(BaseModel):
    train_size: int = Field(ge=0, strict=True)
    validation_size: int = Field(ge=0, strict=True)
    test_size: int = Field(ge=0, strict=True)
    seed: int = config.dataset_split_seed


class PrepareDatasetRequest(BaseModel):
    split_id: str
    categories: Optional[List[QACategory]] = None


class IndexDatasetRequest(BaseModel):
    prepared_id: str = Field(min_length=1)
    partition: Literal["train", "validation", "test"] = "train"
    batch_size: int = Field(default=config.index_batch_size, gt=0, strict=True)


def datasets(request: Request) -> Dict[str, Dataset]:
    if not hasattr(request.app.state, "datasets"):
        request.app.state.datasets = {}
    return request.app.state.datasets


def splits(request: Request) -> Dict[str, Tuple[str, DatasetSplit]]:
    if not hasattr(request.app.state, "dataset_splits"):
        request.app.state.dataset_splits = {}
    return request.app.state.dataset_splits


def prepared_datasets(request: Request) -> Dict[str, PreparedDataset]:
    if not hasattr(request.app.state, "prepared_datasets"):
        request.app.state.prepared_datasets = {}
    return request.app.state.prepared_datasets


def prepared_owners(request: Request) -> Dict[str, str]:
    if not hasattr(request.app.state, "prepared_dataset_owners"):
        request.app.state.prepared_dataset_owners = {}
    return request.app.state.prepared_dataset_owners


def prepared_provenance(request: Request, prepared_id: str) -> dict:
    return getattr(request.app.state, "prepared_provenance", {}).get(prepared_id, {})


def get_prepared(request: Request, prepared_id: str) -> PreparedDataset:
    """The prepared dataset behind an id, or a 404 explaining how to get one."""
    prepared = prepared_datasets(request).get(prepared_id)
    if prepared is None:
        raise HTTPException(
            status_code=404,
            detail="Prepared dataset not found. Run load, split and prepare first.",
        )
    return prepared


def partition_of(prepared: PreparedDataset, name: str) -> DatasetPartition:
    return getattr(prepared, name)


def require_indexed_partition(
    request: Request, prepared_id: str, partition: DatasetPartition
) -> None:
    owner = prepared_owners(request).get(prepared_id)
    indexed = getattr(request.app.state, "indexed_conversation_owners", {})
    if owner is None or any(indexed.get(item.id) != owner for item in partition.conversations):
        raise HTTPException(
            status_code=409, detail="Index this prepared dataset's training partition first."
        )


def get_dataset(request: Request, dataset_id: str) -> Dataset:
    dataset = datasets(request).get(dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found. Load it first.")
    return dataset


@router.get("/prepared")
def list_prepared(request: Request) -> list[dict]:
    """Prepared ids still held in this process, newest last.

    Browser state is lost on reload but this is not, so the harness pages can
    offer what the backend still has rather than making the user rerun phase 3.
    """
    owners = prepared_owners(request)
    return [
        {
            "prepared_id": prepared_id,
            "dataset_id": owners.get(prepared_id),
            "partitions": {
                name: {
                    "conversation_count": len(partition.conversations),
                    "qa_count": len(partition.qa),
                    "turn_count": sum(
                        len(session.turns)
                        for conversation in partition.conversations
                        for session in conversation.sessions
                    ),
                    "conversation_ids": [item.id for item in partition.conversations],
                }
                for name, partition in (
                    ("train", prepared.train),
                    ("validation", prepared.validation),
                    ("test", prepared.test),
                )
            },
        }
        for prepared_id, prepared in prepared_datasets(request).items()
    ]


@router.get("/prepared/{prepared_id}/questions")
def list_questions(
    prepared_id: str,
    request: Request,
    partition: Literal["train", "validation", "test"] = "train",
    conversation_id: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=500),
) -> dict:
    """Questions from one prepared partition, with their evidence annotations.

    The retrieval harness needs a real question and the turns that answer it to
    report recall at all, and R0 is defined against exactly these annotations.
    They are served from the prepared partition rather than re-read from disk,
    so the category filter applied in phase 3 still holds.
    """
    prepared = get_prepared(request, prepared_id)
    page = ListQuestions().execute(
        partition_of(prepared, partition), conversation_id=conversation_id, limit=limit
    )
    return {
        "prepared_id": prepared_id,
        "partition": partition,
        "conversation_id": conversation_id,
        "total": page.total,
        "questions": [asdict(qa) for qa in page.questions],
    }


@router.post("/load", status_code=201)
def load_dataset(body: LoadDatasetRequest, request: Request) -> dict:
    try:
        source = LoCoMoAdapter(Path(body.path))
        dataset = LoadDataset(source).execute()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Dataset file not found.")
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error))
    dataset_id = str(uuid4())
    datasets(request)[dataset_id] = dataset
    if not hasattr(request.app.state, "corpus_hashes"):
        request.app.state.corpus_hashes = {}
    request.app.state.corpus_hashes[dataset_id] = source.corpus_sha256
    return {
        "dataset_id": dataset_id,
        "conversation_count": len(dataset.conversations),
        "qa_count": len(dataset.qa),
        "conversation_ids": dataset.conversation_ids,
    }


@router.post("/{dataset_id}/splits", status_code=201)
def create_split(dataset_id: str, body: CreateSplitRequest, request: Request) -> dict:
    dataset = get_dataset(request, dataset_id)
    try:
        split = CreateDatasetSplit().execute(
            dataset.conversation_ids,
            body.train_size,
            body.validation_size,
            body.test_size,
            body.seed,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))
    split_id = str(uuid4())
    splits(request)[split_id] = (dataset_id, split)
    return {
        "dataset_id": dataset_id,
        "split_id": split_id,
        "seed": body.seed,
        "train_conversation_ids": split.train_conversation_ids,
        "validation_conversation_ids": split.validation_conversation_ids,
        "test_conversation_ids": split.test_conversation_ids,
    }


@router.post("/{dataset_id}/prepare")
def prepare_dataset(dataset_id: str, body: PrepareDatasetRequest, request: Request) -> dict:
    dataset = get_dataset(request, dataset_id)
    entry = splits(request).get(body.split_id)
    if entry is None or entry[0] != dataset_id:
        raise HTTPException(status_code=404, detail="Split not found for this dataset.")
    try:
        prepared = PrepareDataset().execute(dataset, entry[1], body.categories)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))
    # Retain the prepared data for subsequent indexing/evaluation stages.
    prepared_id = str(uuid4())
    prepared_datasets(request)[prepared_id] = prepared
    prepared_owners(request)[prepared_id] = dataset_id
    if not hasattr(request.app.state, "prepared_provenance"):
        request.app.state.prepared_provenance = {}
    request.app.state.prepared_provenance[prepared_id] = {
        "dataset_id": dataset_id,
        "corpus_sha256": getattr(request.app.state, "corpus_hashes", {}).get(dataset_id),
        "split_id": body.split_id,
        "split": asdict(entry[1]),
        "categories": body.categories,
    }
    return {
        "dataset_id": dataset_id,
        "split_id": body.split_id,
        "prepared_id": prepared_id,
        "validation_status": "passed",
        "categories": body.categories,
        "partitions": {
            name: {
                "conversation_count": len(partition.conversations),
                "qa_count": len(partition.qa),
            }
            for name, partition in (
                ("train", prepared.train),
                ("validation", prepared.validation),
                ("test", prepared.test),
            )
        },
    }


@router.post("/{dataset_id}/index")
def index_dataset(dataset_id: str, body: IndexDatasetRequest, request: Request) -> dict:
    get_dataset(request, dataset_id)
    prepared = prepared_datasets(request).get(body.prepared_id)
    if prepared is None or prepared_owners(request).get(body.prepared_id) != dataset_id:
        raise HTTPException(status_code=404, detail="Prepared dataset not found for this dataset.")
    partition = partition_of(prepared, body.partition)

    if not memory_index_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Indexing or a reward build is already in progress.")
    try:
        embedder, store = memory_resources(request, ensure_collection=True)
        indexer = IndexDataset(embedder, store)
        indexed = getattr(request.app.state, "indexed_conversation_owners", {})
        request.app.state.indexed_conversation_owners = indexed
        for conversation in partition.conversations:
            indexed.pop(conversation.id, None)
        indexed_count = indexer.execute(partition.conversations, batch_size=body.batch_size)
        indexed.update((conversation.id, dataset_id) for conversation in partition.conversations)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except Exception as error:
        logger.exception("Dataset indexing failed for %s", dataset_id)
        raise HTTPException(
            status_code=503,
            detail="Indexing failed. Check backend logs and retry; earlier batches may have been stored.",
        ) from error
    finally:
        memory_index_lock.release()

    return {
        "dataset_id": dataset_id,
        "prepared_id": body.prepared_id,
        "partition": body.partition,
        "conversation_count": len(partition.conversations),
        "indexed_memory_count": indexed_count,
        "collection": indexer.memory_store.collection_name,
        "embedding_model": config.embedding_model,
        "embedding_revision": config.embedding_revision,
        "vector_size": indexer.embedder.vector_size,
    }
