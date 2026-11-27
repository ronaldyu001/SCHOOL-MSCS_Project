import re
from collections import Counter
from collections.abc import Callable, Iterable, Iterator
from functools import cache

from application.ports.models import ContextWindowExceeded
from application.use_cases.generation.answer_question import answer_abstained
from application.use_cases.retrieval import BuiltContext
from domain.entities import Conversation

from .reward_input import RewardInput, RewardInputSkipped, RewardSkip, TrainingQuestion
from .turns import conversation_turns


def _normalized_tokens(answer: str) -> Counter[str]:
    return Counter(re.findall(r"[^\W_]+", answer.casefold()))


class R1Builder:
    """Compare answers from the full conversation and a retrieved context."""

    def __init__(
        self,
        answer: Callable[[str, str], str],
        fits_answer_context: Callable[[str, str], bool],
        *,
        teacher: Callable[[str, str], str] | None = None,
    ) -> None:
        self._answer = answer
        self._fits = fits_answer_context
        self._teacher = teacher

    def execute(
        self,
        conversations: Iterable[Conversation],
        questions: Iterable[TrainingQuestion],
    ) -> Iterator[RewardInput | RewardSkip]:
        histories = {
            conversation.id: "\n\n".join(turn.text for turn in conversation_turns(conversation))
            for conversation in conversations
        }
        for question in questions:
            history = histories.get(question.conversation_id)
            if history is None:
                yield RewardSkip(question.id, "missing_conversation")
                continue
            if not question.question.strip():
                yield RewardSkip(question.id, "invalid_question")
                continue
            if not history:
                yield RewardSkip(question.id, "empty_history")
                continue
            yield RewardInput(
                question.id,
                question.conversation_id,
                question.question,
                self._make_scorer(question.question, history),
            )

    def _make_scorer(self, question: str, history: str) -> Callable[[BuiltContext], float]:
        @cache
        def teacher_answer() -> tuple[Counter[str], int]:
            if self._teacher is None and not self._fits(question, history):
                raise RewardInputSkipped("full_history_too_long")
            teacher = self._answer if self._teacher is None else self._teacher
            try:
                answer = teacher(question, history)
            except ContextWindowExceeded as error:
                raise RewardInputSkipped("full_history_too_long") from error
            if answer_abstained(answer):
                raise RewardInputSkipped("teacher_abstained")
            tokens = _normalized_tokens(answer)
            return tokens, tokens.total()

        def score(context: BuiltContext) -> float:
            expected, expected_count = teacher_answer()
            if not context.text:
                return 0.0
            if not self._fits(question, context.text):
                raise RewardInputSkipped("retrieved_context_too_long")
            answer = self._answer(question, context.text)
            if answer_abstained(answer):
                return 0.0
            actual = _normalized_tokens(answer)
            return 2 * (expected & actual).total() / (expected_count + actual.total())

        return score
