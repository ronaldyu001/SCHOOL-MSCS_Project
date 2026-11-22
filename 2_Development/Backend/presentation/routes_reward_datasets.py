"""Build rewrite training data from a prepared partition.

The same pipeline as `presentation/build_reward_datasets.py`, driven from the
API instead of the command line: sample candidate rewrites, retrieve and pack
for each, score every candidate with the selected reward, and keep the winner.

Small pilots can use the synchronous endpoint. The build job endpoints also
support the full training partition without keeping a single request open.
"""

import logging
from concurrent.futures import Future
from dataclasses import asdict, dataclass, field
from threading import Event, Lock, Thread
from time import perf_counter
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from application.use_cases.generation.rewrite_query import REWRITE_PROMPT_VERSION
from application.use_cases.training.build_reward_dataset import RewardBuildSettings
from application.use_cases.training.build_reward_datasets import (
    REWARD_IDS, REWARD_PIPELINE_VERSION, BuildRewardDatasets,
)
from application.use_cases.training.manage_artifacts import SaveRewardDatasets
from domain.entities import DatasetPartition
from infrastructure.config import config

from .artifact_routes import artifact_router
from .resources import language_model, memory_resources, require_collection, resolve_checkpoint
from .routes_dataset import (
    get_prepared, memory_index_lock, prepared_provenance, require_indexed_partition,
)
from .routes_model import MODEL_ID_PATTERN


router = APIRouter()
router.include_router(artifact_router("/datasets", "datasets"))
logger = logging.getLogger(__name__)


class RewardDatasetRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    prepared_id: str = Field(min_length=1)
    partition: Literal["train"] = "train"
    rewards: list[str] = Field(default=list(REWARD_IDS), min_length=1, max_length=4)
    max_inputs_per_reward: int | None = Field(default=4, ge=1, strict=True)
    keep_all_one_ties: bool = False
    seed: int = 123
    candidates: int = Field(default=4, ge=2, le=16, strict=True)
    temperature: float = Field(default=0.7, gt=0, le=5, allow_inf_nan=False)
    rewrite_max_tokens: int = Field(default=48, gt=0, le=256, strict=True)
    top_k: int = Field(default=20, gt=0, le=50, strict=True)
    token_budget: int = Field(default=512, gt=0, le=8192, strict=True)
    answer_max_tokens: int = Field(default=64, gt=0, le=256, strict=True)
    r2_prior_turns: int = Field(default=3, ge=1, le=10, strict=True)
    r3_max_tokens: int = Field(default=64, gt=0, le=256, strict=True)
    model_id: str | None = Field(default=None, max_length=193, pattern=MODEL_ID_PATTERN)
    revision: str | None = Field(default=None, pattern=r"\S")

    @field_validator("rewards")
    @classmethod
    def _known_rewards(cls, value: list[str]) -> list[str]:
        unknown = [reward for reward in value if reward not in REWARD_IDS]
        if unknown:
            raise ValueError(f"Unknown rewards: {', '.join(unknown)}.")
        # Deduplicate while keeping the catalogue's order, which also keeps R0
        # and R1 adjacent so the builder can share their retrieval work.
        return [reward for reward in REWARD_IDS if reward in value]


class ExampleOut(BaseModel):
    prompt: str
    completion: str


class OutcomeOut(BaseModel):
    input_id: str
    candidate_count: int
    skip_reason: str | None
    winning_score: float | None
    top_ties: int
    tied_score: float | None
    kept_all_one_tie: bool


class RewardResult(BaseModel):
    reward: str
    dataset_id: str
    attempted: int
    kept: int
    skipped: dict[str, int]
    tied_winners: int
    kept_all_one_ties: int
    examples: list[ExampleOut]
    outcomes: list[OutcomeOut]


class RewardDatasetResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    prepared_id: str
    partition: str
    conversation_count: int
    qa_count: int
    collection: str
    model_id: str
    model_revision: str | None
    embedding_model: str
    rewrite_prompt_version: str
    reward_pipeline_version: int
    settings: dict
    results: list[RewardResult]
    elapsed_seconds: float


class RewardBuildStatus(BaseModel):
    id: UUID
    status: Literal["running", "cancelling", "cancelled", "saving", "completed"]
    attempted: dict[str, int]
    result: RewardDatasetResponse | None = None


class RewardBuildCancelled(Exception):
    pass


@dataclass
class RewardBuildJob:
    id: UUID = field(default_factory=uuid4)
    future: Future[RewardDatasetResponse | None] = field(default_factory=Future)
    attempted: dict[str, int] = field(default_factory=dict)
    _stop: Event = field(default_factory=Event)
    _phase_lock: Lock = field(default_factory=Lock)
    _saving: bool = False

    def report(self, reward: str, count: int) -> None:
        # One worker writes progress. Publish a new snapshot for status readers.
        self.attempted = {**self.attempted, reward: count}

    def check_cancelled(self) -> None:
        if self._stop.is_set():
            raise RewardBuildCancelled

    def begin_saving(self) -> None:
        with self._phase_lock:
            self.check_cancelled()
            self._saving = True

    def request_stop(self) -> None:
        with self._phase_lock:
            if not self._saving and not self.future.done():
                self._stop.set()

    def status(self) -> RewardBuildStatus:
        with self._phase_lock:
            if self.future.done():
                result = self.future.result()
                return RewardBuildStatus(
                    id=self.id, status="completed" if result is not None else "cancelled",
                    attempted=self.attempted, result=result,
                )
            phase = "saving" if self._saving else "cancelling" if self._stop.is_set() else "running"
            return RewardBuildStatus(id=self.id, status=phase, attempted=self.attempted)


def _prepare_build(
    body: RewardDatasetRequest, request: Request,
) -> tuple[DatasetPartition, RewardBuildSettings]:
    partition = get_prepared(request, body.prepared_id).train

    try:
        BuildRewardDatasets.validate_inputs(partition, body.rewards)
        settings = RewardBuildSettings(
            seed=body.seed,
            candidates=body.candidates,
            temperature=body.temperature,
            rewrite_max_tokens=body.rewrite_max_tokens,
            top_k=body.top_k,
            token_budget=body.token_budget,
            max_inputs_per_reward=body.max_inputs_per_reward,
            keep_all_one_ties=body.keep_all_one_ties,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return partition, settings


def _reserve_index() -> None:
    if not memory_index_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=409,
            detail="Indexing or another reward build is in progress. Wait and retry.",
        )


@router.post("/datasets")
def build_reward_datasets(
    body: RewardDatasetRequest, request: Request,
) -> RewardDatasetResponse:
    """Score a small pilot in a single request."""
    if body.max_inputs_per_reward is None or body.max_inputs_per_reward > 50:
        raise HTTPException(status_code=422, detail="Use POST /rewards/builds for full or larger builds.")
    partition, settings = _prepare_build(body, request)
    _reserve_index()
    try:
        return _build(body, request, partition, settings)
    finally:
        memory_index_lock.release()


@router.post("/builds", status_code=202)
def start_reward_build(body: RewardDatasetRequest, request: Request) -> RewardBuildStatus:
    partition, settings = _prepare_build(body, request)
    _reserve_index()
    try:
        require_indexed_partition(request, body.prepared_id, partition)
        job = RewardBuildJob(attempted=dict.fromkeys(body.rewards, 0))

        def run() -> None:
            try:
                job.future.set_result(_build(body, request, partition, settings, job))
            except RewardBuildCancelled:
                job.future.set_result(None)
            except Exception as error:
                job.future.set_exception(error)
            finally:
                memory_index_lock.release()

        previous_job = getattr(request.app.state, "reward_build_job", None)
        request.app.state.reward_build_job = job
        try:
            Thread(target=run, name=f"reward-build-{job.id}", daemon=True).start()
        except BaseException:
            request.app.state.reward_build_job = previous_job
            raise
    except BaseException:
        memory_index_lock.release()
        raise
    return RewardBuildStatus(id=job.id, status="running", attempted=job.attempted)


def _find_build(build_id: UUID, request: Request) -> RewardBuildJob:
    job = getattr(request.app.state, "reward_build_job", None)
    if job is None or job.id != build_id:
        raise HTTPException(status_code=404, detail="Reward build not found.")
    return job


@router.get("/builds/{build_id}")
def get_reward_build(build_id: UUID, request: Request) -> RewardBuildStatus:
    return _find_build(build_id, request).status()


@router.post("/builds/{build_id}/cancel")
def stop_reward_build(build_id: UUID, request: Request) -> RewardBuildStatus:
    job = _find_build(build_id, request)
    job.request_stop()
    return job.status()


def _build(
    body: RewardDatasetRequest,
    request: Request,
    partition: DatasetPartition,
    settings: RewardBuildSettings,
    job: RewardBuildJob | None = None,
) -> RewardDatasetResponse:
    started = perf_counter()
    try:
        if job is not None:
            job.check_cancelled()
        require_indexed_partition(request, body.prepared_id, partition)
        embedder, store = memory_resources(request)
        require_collection(store)
        model_id, revision = resolve_checkpoint(body.model_id, body.revision)
        if job is not None:
            job.check_cancelled()
        model = language_model(request, model_id, revision)
        if job is not None:
            job.check_cancelled()
        datasets = BuildRewardDatasets(model, model, model, embedder, store).execute(
            partition,
            body.rewards,
            settings,
            answer_max_tokens=body.answer_max_tokens,
            r2_prior_turns=body.r2_prior_turns,
            r3_max_tokens=body.r3_max_tokens,
            report_progress=job.report if job is not None else None,
            check_cancelled=job.check_cancelled if job is not None else None,
        )
    except (HTTPException, RewardBuildCancelled):
        raise
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.exception("Reward dataset build failed for %s", body.prepared_id)
        raise HTTPException(
            status_code=503,
            detail="The reward build failed. Check backend logs and retry.",
        ) from error
    build_settings = {
        **asdict(settings),
        "answer_max_tokens": body.answer_max_tokens,
        "r2_prior_turns": body.r2_prior_turns,
        "r3_max_tokens": body.r3_max_tokens,
    }
    checkpoint_revision = model.resolved_revision or revision
    if job is not None:
        job.begin_saving()
    try:
        saved = SaveRewardDatasets(request.app.state.artifact_store).execute(datasets, {
            **prepared_provenance(request, body.prepared_id),
            "source": "api",
            "prepared_id": body.prepared_id,
            "partition": body.partition,
            "train_conversation_ids": [conversation.id for conversation in partition.conversations],
            "model_id": model_id,
            "model_revision": checkpoint_revision,
            "requested_model_revision": revision,
            "embedding_model": config.embedding_model,
            "embedding_revision": config.embedding_revision,
            "embedding_device": config.embedding_device,
            "embedding_max_length": config.embedding_max_length,
            "embedding_query_instruction": config.embedding_query_instruction,
            "reward_pipeline_version": REWARD_PIPELINE_VERSION,
            "rewrite_prompt_version": REWRITE_PROMPT_VERSION,
            "collection": store.collection_name,
            "settings": build_settings,
        })
    except (OSError, ValueError) as error:
        logger.exception("Could not save reward datasets for %s", body.prepared_id)
        raise HTTPException(status_code=503, detail="Could not save the reward datasets.") from error

    results = []
    for reward in body.rewards:
        dataset = datasets[reward]
        summary = dataset.summary()
        results.append(RewardResult(
            reward=reward,
            dataset_id=saved[reward]["id"],
            attempted=summary["attempted"],
            kept=summary["kept"],
            skipped=summary["skipped"],
            tied_winners=summary["tied_winners"],
            kept_all_one_ties=summary["kept_all_one_ties"],
            examples=[ExampleOut(**asdict(example)) for example in dataset.examples],
            outcomes=[OutcomeOut(**asdict(outcome)) for outcome in dataset.outcomes],
        ))

    return RewardDatasetResponse(
        prepared_id=body.prepared_id,
        partition=body.partition,
        conversation_count=len(partition.conversations),
        qa_count=len(partition.qa),
        collection=store.collection_name,
        model_id=model_id,
        model_revision=checkpoint_revision,
        embedding_model=config.embedding_model,
        rewrite_prompt_version=REWRITE_PROMPT_VERSION,
        reward_pipeline_version=REWARD_PIPELINE_VERSION,
        settings=build_settings,
        results=results,
        elapsed_seconds=round(perf_counter() - started, 3),
    )
