from collections.abc import Mapping
from typing import BinaryIO

from application.ports.training.artifacts import ArtifactStore
from .build_reward_dataset import RewardDataset
from .training_run import ACTIVE_STATUSES, ArtifactConflict, ArtifactKind, utc_now


class SaveRewardDatasets:
    def __init__(self, store: ArtifactStore) -> None:
        self.store = store

    def execute(self, datasets: Mapping[str, RewardDataset], provenance: dict) -> dict[str, dict]:
        with self.store.transaction():
            return self.store.save_datasets(datasets, provenance)


class ReadArtifacts:
    def __init__(self, store: ArtifactStore) -> None:
        self.store = store

    def execute(self, kind: ArtifactKind, artifact_id: str | None = None) -> dict | list[dict]:
        with self.store.transaction():
            self.store.recover_interrupted()
            if artifact_id is None:
                return self.store.list_artifacts(kind)
            return self.store.get(kind, artifact_id)


class UpdateArtifact:
    def __init__(self, store: ArtifactStore) -> None:
        self.store = store

    def execute(self, kind: ArtifactKind, artifact_id: str, changes: dict[str, str]) -> dict:
        if not changes or changes.keys() - {"name", "notes"}:
            raise ValueError("Provide a name or notes to update.")
        with self.store.transaction():
            self.store.recover_interrupted()
            artifact = self.store.get(kind, artifact_id)
            artifact.update(changes, updated_at=utc_now())
            return self.store.write(kind, artifact_id, artifact)


class DeleteArtifact:
    def __init__(self, store: ArtifactStore) -> None:
        self.store = store

    def execute(self, kind: ArtifactKind, artifact_id: str) -> None:
        with self.store.transaction():
            self.store.recover_interrupted()
            artifact = self.store.get(kind, artifact_id)
            if kind == "datasets":
                if any(run["status"] in ACTIVE_STATUSES and run["dataset_id"] == artifact["id"]
                       for run in self.store.list_artifacts("runs")):
                    raise ArtifactConflict("This dataset is in use by an active training run.")
            elif artifact["status"] in ACTIVE_STATUSES:
                raise ArtifactConflict("This run is still active.")
            if kind == "runs" and any(
                evaluation["status"] in ACTIVE_STATUSES and any(
                    source["run_id"] == artifact["id"]
                    for seed in evaluation["adapters"].values() for source in seed.values()
                ) for evaluation in self.store.list_artifacts("evaluations")
            ):
                raise ArtifactConflict("This adapter is in use by an active evaluation.")
            self.store.delete(kind, artifact_id)


class DownloadArtifact:
    def __init__(self, store: ArtifactStore) -> None:
        self.store = store

    def execute(self, kind: ArtifactKind, artifact_id: str) -> BinaryIO:
        with self.store.transaction():
            self.store.recover_interrupted()
            artifact = self.store.get(kind, artifact_id)
            if kind == "runs" and artifact["status"] != "completed":
                raise ArtifactConflict("The adapter is available after the run completes.")
            if kind == "evaluations" and artifact["status"] != "completed":
                raise ArtifactConflict("Results are available after the evaluation completes.")
            return self.store.bundle(kind, artifact_id)
