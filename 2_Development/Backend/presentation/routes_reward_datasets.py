"""Build rewrite training data from a prepared partition.

The same pipeline as `presentation/build_reward_datasets.py`, driven from the
API instead of the command line: sample candidate rewrites, retrieve and pack
for each, score every candidate with the selected reward, and keep the winner.

This route is for pilots. It runs synchronously and holds one process-wide
lock, because it loads the reader model and embeds on the same host as the API,
so the input and candidate limits are deliberately small. Full runs belong in
the command-line builder, which can index its own corpus-scoped collection and
write the manifest.
"""

import logging
from dataclasses import asdict
from time import perf_counter
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from application.use_cases.generation.rewrite_query import REWRITE_PROMPT_VERSION
from application.use_cases.training.build_reward_dataset import RewardBuildSettings
from application.use_cases.training.build_reward_datasets import (
    REWARD_IDS, REWARD_PIPELINE_VERSION, BuildRewardDatasets,
)
from infrastructure.config import config

from .resources import language_model, memory_resources, require_collection, resolve_checkpoint
from .routes_dataset import get_prepared, require_indexed_partition, memory_index_lock
from .routes_model import MODEL_ID_PATTERN


router = APIRouter()
logger = logging.getLogger(__name__)


class RewardDatasetRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    prepared_id: str = Field(min_length=1)
    partition: Literal["train"] = "train"
    rewards: list[str] = Field(default=list(REWARD_IDS), min_length=1, max_length=4)
    max_inputs_per_reward: int = Field(default=4, ge=1, le=50, strict=True)
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


class RewardResult(BaseModel):
    reward: str
    attempted: int
    kept: int
    skipped: dict[str, int]
    tied_winners: int
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


@router.post("/datasets")
def build_reward_datasets(
    body: RewardDatasetRequest, request: Request
) -> RewardDatasetResponse:
    """Score candidate rewrites for a prepared partition and keep the winners."""
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
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    # Keep the selected index stable throughout the build.
    if not memory_index_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=409,
            detail="Indexing or another reward build is in progress. Wait and retry.",
        )
    started = perf_counter()
    try:
        require_indexed_partition(request, body.prepared_id, partition)
        embedder, store = memory_resources(request)
        require_collection(store)
        model_id, revision = resolve_checkpoint(body.model_id, body.revision)
        model = language_model(request, model_id, revision)
        datasets = BuildRewardDatasets(model, model, model, embedder, store).execute(
            partition,
            body.rewards,
            settings,
            answer_max_tokens=body.answer_max_tokens,
            r2_prior_turns=body.r2_prior_turns,
            r3_max_tokens=body.r3_max_tokens,
        )
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.exception("Reward dataset build failed for %s", body.prepared_id)
        raise HTTPException(
            status_code=503,
            detail="The reward build failed. Check backend logs and retry.",
        ) from error
    finally:
        memory_index_lock.release()

    results = []
    for reward in body.rewards:
        dataset = datasets[reward]
        summary = dataset.summary()
        results.append(RewardResult(
            reward=reward,
            attempted=summary["attempted"],
            kept=summary["kept"],
            skipped=summary["skipped"],
            tied_winners=summary["tied_winners"],
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
        model_revision=revision,
        embedding_model=config.embedding_model,
        rewrite_prompt_version=REWRITE_PROMPT_VERSION,
        reward_pipeline_version=REWARD_PIPELINE_VERSION,
        settings={
            **asdict(settings),
            "answer_max_tokens": body.answer_max_tokens,
            "r2_prior_turns": body.r2_prior_turns,
            "r3_max_tokens": body.r3_max_tokens,
        },
        results=results,
        elapsed_seconds=round(perf_counter() - started, 3),
    )
