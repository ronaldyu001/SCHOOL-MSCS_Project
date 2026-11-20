from collections.abc import Callable, Iterable, Iterator
from functools import cache

from application.ports.models import ContextWindowExceeded
from application.use_cases.retrieval import BuiltContext
from domain.entities import Conversation

from .reward_input import RewardInput, RewardInputSkipped, RewardSkip
from .turns import sample_turns


class R2Builder:
    """Reward retrieval that improves prediction of a hidden conversation turn."""

    def __init__(
        self,
        score_continuation: Callable[[str, str], float],
        prior_turns: int = 3,
    ) -> None:
        if type(prior_turns) is not int or prior_turns < 1:
            raise ValueError("The number of recent turns must be a positive integer.")
        self._score_continuation = score_continuation
        self._prior_turns = prior_turns

    def execute(
        self, conversations: Iterable[Conversation], *, seed: int = 123
    ) -> Iterator[RewardInput | RewardSkip]:
        for conversation_id, turns, position in sample_turns(
            conversations, seed=seed, require_prior=True
        ):
            hidden = turns[position].turn
            input_id = f"{conversation_id}:{hidden.id}"
            if not hidden.text.strip():
                yield RewardSkip(input_id, "blank_hidden_turn")
                continue
            earlier = turns[:position]
            recent = "\n".join(turn.text for turn in earlier[-self._prior_turns:])
            completion = f"{hidden.speaker}: {hidden.text}"
            yield RewardInput(
                input_id,
                conversation_id,
                recent,
                self._make_scorer(recent, completion),
                eligible_turn_ids=frozenset(turn.turn.id for turn in earlier),
            )

    def _make_scorer(self, recent: str, completion: str) -> Callable[[BuiltContext], float]:
        prompt = f"Recent conversation:\n{recent}\n\nNext message:\n"

        @cache
        def baseline() -> float:
            try:
                return self._score_continuation(prompt, completion)
            except ContextWindowExceeded as error:
                raise RewardInputSkipped("prediction_baseline_too_long") from error

        def score(context: BuiltContext) -> float:
            if not context.text:
                return 0.0
            augmented = f"Retrieved memories:\n{context.text}\n\n{prompt}"
            base_score = baseline()
            try:
                retrieved_score = self._score_continuation(augmented, completion)
            except ContextWindowExceeded as error:
                raise RewardInputSkipped("prediction_context_too_long") from error
            return retrieved_score - base_score

        return score
