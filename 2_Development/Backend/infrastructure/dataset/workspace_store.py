"""Atomic, versioned experiment state stored beside durable training artifacts."""
import os
from functools import wraps
from inspect import signature
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import RLock
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from domain.entities import Dataset, DatasetSplit, PreparedDataset

workspace_lock = RLock()


class WorkspaceSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    datasets: dict[str, Dataset] = Field(default_factory=dict)
    dataset_splits: dict[str, tuple[str, DatasetSplit]] = Field(default_factory=dict)
    prepared_datasets: dict[str, PreparedDataset] = Field(default_factory=dict)
    prepared_dataset_owners: dict[str, str] = Field(default_factory=dict)
    prepared_provenance: dict[str, dict] = Field(default_factory=dict)
    corpus_hashes: dict[str, str] = Field(default_factory=dict)
    split_seeds: dict[str, int] = Field(default_factory=dict)
    index_records: dict[str, dict] = Field(default_factory=dict)
    active_training_prepared_id: str | None = None


class DatasetWorkspaceStore:
    def __init__(self, root: Path):
        self.path = root / "workspace" / "datasets.json"

    def restore(self, state) -> None:
        with workspace_lock:
            snapshot = (WorkspaceSnapshot.model_validate_json(self.path.read_bytes())
                        if self.path.exists() else WorkspaceSnapshot())
            for name in WorkspaceSnapshot.model_fields:
                if name != "version":
                    setattr(state, name, getattr(snapshot, name))
            if "active_training_prepared_id" not in snapshot.model_fields_set:
                state.active_training_prepared_id = next((
                    prepared_id
                    for prepared_id in reversed(snapshot.prepared_datasets)
                    if (owner := snapshot.prepared_dataset_owners.get(prepared_id))
                    and (train := snapshot.prepared_datasets[prepared_id].train.conversations)
                    and all(
                        snapshot.index_records.get(item.id, {}).get("dataset_id") == owner
                        for item in train
                    )
                ), None)
            # Ownership is established only after checking the actual Qdrant points.
            state.indexed_conversation_owners = {}

    def save(self, state) -> None:
        with workspace_lock:
            snapshot = WorkspaceSnapshot(**{
                name: getattr(state, name)
                for name in WorkspaceSnapshot.model_fields
                if name != "version" and hasattr(state, name)
            })
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with NamedTemporaryFile(mode="w", dir=self.path.parent, delete=False) as output:
                    temporary = Path(output.name)
                    output.write(snapshot.model_dump_json())
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, self.path)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)


def save_workspace(request) -> None:
    store = getattr(request.app.state, "dataset_workspace_store", None)
    if store is not None:
        store.save(request.app.state)


def workspace_write(operation):
    parameters = signature(operation)
    @wraps(operation)
    def run(*args, **kwargs):
        with workspace_lock:
            result = operation(*args, **kwargs)
            save_workspace(parameters.bind(*args, **kwargs).arguments["request"])
            return result
    return run
