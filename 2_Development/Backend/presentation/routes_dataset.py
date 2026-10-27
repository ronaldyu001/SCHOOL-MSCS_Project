import logging
from pathlib import Path
from threading import Lock
from typing import Dict, List, Literal, Optional, Tuple
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from application.use_cases.dataset import CreateDatasetSplit, IndexDataset, LoadDataset, PrepareDataset
from domain.entities import Dataset, DatasetSplit, QACategory
from infrastructure.dataset.locomo_adapter import LoCoMoAdapter
from infrastructure.config import config

router = APIRouter(prefix="/data", tags=["data"])
logger = logging.getLogger(__name__)
_index_lock = Lock()


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


def get_dataset(request: Request, dataset_id: str) -> Dataset:
    dataset = datasets(request).get(dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found. Load it first.")
    return dataset


@router.post("/load", status_code=201)
def load_dataset(body: LoadDatasetRequest, request: Request) -> dict:
    try:
        dataset = LoadDataset(LoCoMoAdapter(Path(body.path))).execute()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Dataset file not found.")
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error))
    dataset_id = str(uuid4())
    datasets(request)[dataset_id] = dataset
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
    if not hasattr(request.app.state, "prepared_datasets"):
        request.app.state.prepared_datasets = {}
    prepared_id = str(uuid4())
    request.app.state.prepared_datasets[prepared_id] = prepared
    if not hasattr(request.app.state, "prepared_dataset_owners"):
        request.app.state.prepared_dataset_owners = {}
    request.app.state.prepared_dataset_owners[prepared_id] = dataset_id
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
    owners = getattr(request.app.state, "prepared_dataset_owners", {})
    prepared = getattr(request.app.state, "prepared_datasets", {}).get(body.prepared_id)
    if prepared is None or owners.get(body.prepared_id) != dataset_id:
        raise HTTPException(status_code=404, detail="Prepared dataset not found for this dataset.")
    partition = getattr(prepared, body.partition)

    # Serialize indexing within this process, including first-time model/collection setup.
    with _index_lock:
        try:
            if not hasattr(request.app.state, "dataset_indexer"):
                from infrastructure.models.embedding import BGEAdapter
                from infrastructure.memory_store import QdrantAdapter

                embedder = BGEAdapter()
                store = QdrantAdapter.from_config(vector_size=embedder.vector_size)
                try:
                    store.ensure_collection()
                except Exception:
                    store.client.close()
                    raise
                request.app.state.dataset_indexer = IndexDataset(embedder, store)
            indexer = request.app.state.dataset_indexer
            indexed_count = indexer.execute(partition.conversations, batch_size=body.batch_size)
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except Exception as error:
            logger.exception("Dataset indexing failed for %s", dataset_id)
            raise HTTPException(
                status_code=503,
                detail="Indexing failed. Check backend logs and retry; earlier batches may have been stored.",
            ) from error

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
