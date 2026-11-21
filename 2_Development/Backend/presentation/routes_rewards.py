"""The reward bank, as the backend actually implements it.

The catalogue is served rather than hard-coded in the client so the frontend
cannot offer a reward this build does not have, and so the one scorer that
reads evidence labels is labelled as such wherever it appears.
"""

from dataclasses import asdict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from application.use_cases.retrieval.score_evidence import MeasureEvidence
from application.use_cases.training.select_rewrite import SelectRewrite

from .routes_reward_datasets import router as datasets_router


router = APIRouter(prefix="/rewards", tags=["rewards"])
router.include_router(datasets_router)


class RewardDef(BaseModel):
    id: str
    title: str
    summary: str
    signal: str
    label_free: bool
    needs_questions: bool
    needs_evidence_labels: bool
    skip_reasons: list[str]


CATALOGUE: tuple[RewardDef, ...] = (
    RewardDef(
        id="r0",
        title="Supervised ceiling",
        summary="Checks the memories against the answer key that came with the dataset.",
        signal="The dataset's answer key.",
        label_free=False,
        needs_questions=True,
        needs_evidence_labels=True,
        skip_reasons=[
            "missing_conversation",
            "invalid_question",
            "missing_evidence",
            "unresolved_evidence",
        ],
    ),
    RewardDef(
        id="r1",
        title="Full-context teacher",
        summary=(
            "Compares the answer you get from a handful of memories with the answer "
            "you get from the whole conversation."
        ),
        signal="The reader, answering the same question twice.",
        label_free=True,
        needs_questions=True,
        needs_evidence_labels=False,
        skip_reasons=[
            "missing_conversation",
            "invalid_question",
            "empty_history",
            "full_history_too_long",
            "teacher_abstained",
            "retrieved_context_too_long",
        ],
    ),
    RewardDef(
        id="r2",
        title="Masked-turn prediction",
        summary=(
            "Checks whether the memories help the model guess what someone said next."
        ),
        signal="The conversation itself. No questions needed.",
        label_free=True,
        needs_questions=False,
        needs_evidence_labels=False,
        skip_reasons=[
            "blank_hidden_turn",
            "prediction_baseline_too_long",
            "prediction_context_too_long",
        ],
    ),
    RewardDef(
        id="r3",
        title="Synthetic evidence",
        summary=(
            "Makes a question out of one message, then checks whether searching finds "
            "that message again."
        ),
        signal="A message used as its own answer.",
        label_free=True,
        needs_questions=False,
        needs_evidence_labels=False,
        skip_reasons=["blank_source_turn", "invalid_synthetic_question"],
    ),
)

class SelectRequest(BaseModel):
    scores: list[float] = Field(min_length=1, max_length=64)


class SelectResponse(BaseModel):
    index: int | None
    score: float | None
    tied_winners: int
    reason: str | None


class EvidenceRequest(BaseModel):
    expected_turn_ids: list[str] = Field(min_length=1, max_length=500)
    actual_turn_ids: list[str] = Field(default_factory=list, max_length=2000)


class EvidenceResponse(BaseModel):
    recall: float
    expected_count: int
    matched_turn_ids: list[str]


@router.get("")
def list_rewards() -> list[RewardDef]:
    """Every reward this build can score, and what each one needs."""
    return list(CATALOGUE)


@router.post("/select")
def select(body: SelectRequest) -> SelectResponse:
    """Apply the winner rule: the first best score, when the scores disagree."""
    try:
        result = SelectRewrite().execute(body.scores)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return SelectResponse(**asdict(result))


@router.post("/evidence")
def evidence(body: EvidenceRequest) -> EvidenceResponse:
    """Recall of the expected turns among the turns a context actually carried."""
    try:
        result = MeasureEvidence().execute(body.expected_turn_ids, body.actual_turn_ids)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return EvidenceResponse(**asdict(result))
