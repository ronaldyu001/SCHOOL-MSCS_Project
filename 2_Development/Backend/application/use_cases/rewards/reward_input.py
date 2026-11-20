from collections.abc import Callable
from dataclasses import dataclass

from application.use_cases.retrieval import BuiltContext


@dataclass(frozen=True)
class TrainingQuestion:
    """A training question with the annotations removed."""

    id: str
    conversation_id: str
    question: str


@dataclass(frozen=True)
class RewardInput:
    input_id: str
    conversation_id: str
    rewrite_input: str
    score: Callable[[BuiltContext], float]
    eligible_turn_ids: frozenset[str] | None = None


@dataclass(frozen=True)
class RewardSkip:
    input_id: str
    reason: str


class RewardInputSkipped(Exception):
    """A scoring prerequisite made this input ineligible."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)
