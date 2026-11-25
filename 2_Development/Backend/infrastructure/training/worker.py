import sys
from pathlib import Path
from subprocess import Popen, TimeoutExpired
from threading import Lock, Thread

from application.use_cases.training.training_run import TrainingRun
from infrastructure.training.artifact_store import FileArtifactStore


class SubprocessTrainingWorker:
    def __init__(self, store: FileArtifactStore) -> None:
        self.store = store
        self._guard = Lock()
        self._process: Popen | None = None

    def launch(self, run: TrainingRun) -> None:
        self._launch(run.id, "infrastructure.training.worker")

    def launch_evaluation(self, run_id: str) -> None:
        self._launch(run_id, "infrastructure.evaluation.worker")

    def _launch(self, run_id: str, module: str) -> None:
        with self._guard, self.store.open_worker_lock() as lease:
            descriptor = lease.fileno()
            # The child keeps this open, including if its API parent exits abruptly.
            process = Popen(
                [sys.executable, "-m", module, str(self.store.root.resolve()), run_id, str(descriptor)],
                pass_fds=(descriptor,),
            )
            self._process = process
            Thread(target=self._reap, args=(process,), daemon=True).start()

    def _reap(self, process: Popen) -> None:
        process.wait()
        with self._guard:
            if self._process is process:
                self._process = None
        with self.store.transaction():
            self.store.recover_interrupted()

    def close(self) -> None:
        with self._guard:
            process = self._process
            if process is None or process.poll() is not None:
                return
            process.terminate()
        try:
            process.wait(timeout=5)
        except TimeoutExpired:
            process.kill()
            process.wait()
        with self.store.transaction():
            self.store.recover_interrupted()


def main() -> None:
    import os

    from application.use_cases.training.train_rewrite_adapter import TrainRewriteAdapter
    from infrastructure.models.llm.transformers_lora_trainer_adapter import (
        TransformersLoRATrainerAdapter,
    )

    root, run_id, descriptor = sys.argv[1:]
    with os.fdopen(int(descriptor), "rb"):
        TrainRewriteAdapter(FileArtifactStore(Path(root)), TransformersLoRATrainerAdapter()).execute(run_id)


if __name__ == "__main__":
    main()
