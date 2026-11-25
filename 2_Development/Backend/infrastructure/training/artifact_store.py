import json
from csv import DictWriter
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import asdict
from fcntl import LOCK_EX, LOCK_NB, flock
from hashlib import file_digest, sha256
from pathlib import Path
from shutil import rmtree
from tempfile import NamedTemporaryFile, TemporaryDirectory, TemporaryFile
from typing import BinaryIO
from uuid import UUID, uuid4
from zipfile import ZipFile

from application.use_cases.training.build_reward_dataset import RewardDataset, TrainingExample
from application.use_cases.training.training_run import (
    ACTIVE_STATUSES, ArtifactKind, ArtifactNotFound, utc_now,
)

ADAPTER_FILES = ("adapter_config.json", "adapter_model.safetensors")
EVALUATION_FILES = ("summary.json", "per-question.jsonl", "budget-curves.csv")


def write_reward_files(directory: Path, name: str, dataset: RewardDataset) -> Path:
    examples = directory / f"{name}.jsonl"
    for path, rows in (
        (examples, dataset.examples),
        (directory / f"{name}.diagnostics.jsonl", dataset.outcomes),
    ):
        with path.open("w", encoding="utf-8") as stream:
            for row in rows:
                stream.write(json.dumps(asdict(row), ensure_ascii=False, allow_nan=False) + "\n")
    return examples


class FileArtifactStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    @contextmanager
    def transaction(self) -> Iterator[None]:
        # API, worker and CLI share this lock on the bind mount.
        self.root.mkdir(parents=True, exist_ok=True)
        with (self.root / ".artifacts.lock").open("a+b") as lock:
            flock(lock, LOCK_EX)
            yield

    def open_worker_lock(self) -> BinaryIO:
        lock = (self.root / ".training.lock").open("a+b")
        try:
            flock(lock, LOCK_EX | LOCK_NB)
        except BaseException:
            lock.close()
            raise
        return lock

    def recover_interrupted(self) -> None:
        try:
            lock = self.open_worker_lock()
        except BlockingIOError:
            return
        with lock:
            for run in self.list_artifacts("runs"):
                if run["status"] in ACTIVE_STATUSES:
                    self.discard_adapter(run["id"])
                    run.update(status="interrupted", error="Training worker stopped before completion.",
                               updated_at=utc_now())
                    self.write("runs", run["id"], run)
            for run in self.list_artifacts("evaluations"):
                if run["status"] in ACTIVE_STATUSES:
                    self.discard_evaluation(run["id"])
                    run.update(status="interrupted", error="Evaluation worker stopped before completion.",
                               updated_at=utc_now())
                    self.write("evaluations", run["id"], run)

    def compute_busy(self) -> bool:
        try:
            with self.open_worker_lock():
                return False
        except BlockingIOError:
            return True

    def _directory(self, kind: ArtifactKind, artifact_id: str) -> Path:
        try:
            canonical = str(UUID(artifact_id))
        except ValueError as error:
            raise ArtifactNotFound("Artifact not found.") from error
        return self.root / kind / canonical

    def list_artifacts(self, kind: ArtifactKind) -> list[dict]:
        items = [
            json.loads(path.read_text(encoding="utf-8"))
            for path in (self.root / kind).glob("*/manifest.json")
            if not path.parent.name.startswith(".")
        ]
        return sorted(items, key=lambda item: (item["created_at"], item["id"]), reverse=True)

    def get(self, kind: ArtifactKind, artifact_id: str) -> dict:
        try:
            path = self._directory(kind, artifact_id) / "manifest.json"
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as error:
            raise ArtifactNotFound("Artifact not found.") from error

    @staticmethod
    def _write_manifest(directory: Path, manifest: dict) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory, delete=False) as stream:
            temporary = Path(stream.name)
            try:
                json.dump(manifest, stream, indent=2, ensure_ascii=False, allow_nan=False)
                stream.write("\n")
                stream.close()
                temporary.replace(directory / "manifest.json")
            finally:
                temporary.unlink(missing_ok=True)

    def write(self, kind: ArtifactKind, artifact_id: str, manifest: dict) -> dict:
        self._write_manifest(self._directory(kind, artifact_id), manifest)
        return manifest

    def delete(self, kind: ArtifactKind, artifact_id: str) -> None:
        target = self._directory(kind, artifact_id)
        removed = target.with_name(f".deleted-{uuid4()}")
        target.rename(removed)
        rmtree(removed)

    def bundle(self, kind: ArtifactKind, artifact_id: str) -> BinaryIO:
        directory = self._directory(kind, artifact_id)
        bundle = TemporaryFile()
        try:
            with ZipFile(bundle, "w") as archive:
                archive.write(directory / "manifest.json", "manifest.json")
                if kind == "datasets":
                    for name in ("examples.jsonl", "examples.diagnostics.jsonl"):
                        archive.write(directory / name, name)
                elif kind == "evaluations":
                    for name in EVALUATION_FILES:
                        archive.write(directory / "results" / name, name)
                else:
                    adapter = directory / "adapter"
                    for path in sorted(adapter.iterdir()):
                        if path.is_file():
                            archive.write(path, path.relative_to(directory))
            bundle.seek(0)
            return bundle
        except BaseException:
            bundle.close()
            raise

    def save_datasets(
        self, datasets: Mapping[str, RewardDataset], provenance: dict
    ) -> dict[str, dict]:
        parent = self.root / "datasets"
        parent.mkdir(parents=True, exist_ok=True)
        build_id = str(uuid4())
        saved = {}
        published: list[Path] = []
        try:
            with TemporaryDirectory(prefix=".build-", dir=parent) as temporary:
                staging = Path(temporary)
                for reward, dataset in datasets.items():
                    dataset_id = str(uuid4())
                    directory = staging / dataset_id
                    directory.mkdir()
                    examples = write_reward_files(directory, "examples", dataset)
                    with examples.open("rb") as source:
                        digest = file_digest(source, "sha256").hexdigest()
                    created = utc_now()
                    settings = provenance.get("settings", {})
                    limit = settings.get("max_inputs_per_reward")
                    scope = "full" if limit is None else f"pilot {limit}"
                    label = f"{reward.upper()} · {scope} · seed {settings.get('seed', '?')} · {created[:16]}"
                    manifest = {
                        "id": dataset_id, "build_id": build_id, "reward": reward,
                        "name": label, "notes": "",
                        "created_at": created, "updated_at": created,
                        "dataset_sha256": digest, "row_count": len(dataset.examples),
                        "summary": dataset.summary(), "provenance": provenance,
                    }
                    self._write_manifest(directory, manifest)
                    saved[reward] = manifest
                for manifest in saved.values():
                    destination = parent / manifest["id"]
                    (staging / manifest["id"]).rename(destination)
                    published.append(destination)
        except BaseException:
            for destination in published:
                rmtree(destination)
            raise
        return saved

    def load_examples(self, dataset_id: str, expected_hash: str) -> list[TrainingExample]:
        try:
            content = (self._directory("datasets", dataset_id) / "examples.jsonl").read_bytes()
        except FileNotFoundError as error:
            raise ValueError("Saved dataset examples are missing. Rebuild the dataset.") from error
        if sha256(content).hexdigest() != expected_hash:
            raise ValueError("Saved dataset does not match its recorded hash. Rebuild the dataset.")
        results = []
        for line_number, line in enumerate(content.split(b"\n"), start=1):
            if not line:
                continue
            try:
                row = json.loads(line)
                if not isinstance(row, dict) or set(row) != {"prompt", "completion"} or not all(
                    isinstance(value, str) and value.strip() for value in row.values()
                ):
                    raise ValueError
            except (ValueError, TypeError) as error:
                raise ValueError(f"Invalid prompt or completion on dataset line {line_number}.") from error
            results.append(TrainingExample(**row))
        if not results:
            raise ValueError("This dataset contains no winning rewrites.")
        return results

    @contextmanager
    def stage_adapter(self, run_id: str) -> Iterator[Path]:
        directory = self._directory("runs", run_id)
        with TemporaryDirectory(prefix=".training-", dir=directory) as temporary:
            output = Path(temporary) / "adapter"
            output.mkdir()
            yield output

    def adapter_directory(self, run_id: str) -> Path:
        return self._directory("runs", run_id) / "adapter"

    @staticmethod
    def _adapter_digest(directory: Path) -> dict[str, str]:
        if not all((directory / name).is_file() for name in ADAPTER_FILES):
            raise ValueError("The trainer did not save a complete adapter.")
        hashes = {}
        for name in ADAPTER_FILES:
            with (directory / name).open("rb") as source:
                hashes[name] = file_digest(source, "sha256").hexdigest()
        return hashes

    def adapter_digest(self, run_id: str) -> dict[str, str]:
        return self._adapter_digest(self.adapter_directory(run_id))

    def publish_adapter(self, run_id: str, staged: Path) -> dict[str, str]:
        hashes = self._adapter_digest(staged)
        staged.rename(self.adapter_directory(run_id))
        return hashes

    def discard_adapter(self, run_id: str) -> None:
        directory = self._directory("runs", run_id)
        for path in [directory / "adapter", *directory.glob(".training-*")]:
            if path.exists():
                rmtree(path)

    def publish_evaluation(self, evaluation_id: str, summary: dict, rows: list[dict]) -> None:
        directory = self._directory("evaluations", evaluation_id)
        with TemporaryDirectory(prefix=".evaluation-", dir=directory) as temporary:
            result = Path(temporary) / "results"
            result.mkdir()
            (result / "summary.json").write_text(
                json.dumps(summary, indent=2, allow_nan=False) + "\n", encoding="utf-8",
            )
            with (result / "per-question.jsonl").open("w", encoding="utf-8") as stream:
                for row in rows:
                    stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
            curves = summary["curves"]
            fields = sorted(set().union(*(row.keys() for row in curves)))
            with (result / "budget-curves.csv").open("w", encoding="utf-8", newline="") as stream:
                writer = DictWriter(stream, fieldnames=fields)
                writer.writeheader()
                writer.writerows(curves)
            result.rename(directory / "results")

    def discard_evaluation(self, evaluation_id: str) -> None:
        directory = self._directory("evaluations", evaluation_id)
        for path in [directory / "results", *directory.glob(".evaluation-*")]:
            if path.exists():
                rmtree(path)
