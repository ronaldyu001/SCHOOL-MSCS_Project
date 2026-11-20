from collections.abc import Callable, Sequence
from dataclasses import dataclass

from application.ports.memory_store import MemoryMatch


@dataclass(frozen=True)
class BuiltContext:
    text: str
    included_matches: tuple[MemoryMatch, ...]
    tokens_used: int

    @property
    def source_turn_ids(self) -> frozenset[str]:
        return frozenset(
            turn_id
            for match in self.included_matches
            for turn_id in match.memory.source_turn_ids
        )


class BuildContext:
    def __init__(self, count_tokens: Callable[[str], int]) -> None:
        self._count_tokens = count_tokens

    def execute(self, matches: Sequence[MemoryMatch], token_budget: int) -> BuiltContext:
        """Pack the longest leading run of complete memory blocks that fits."""
        if type(token_budget) is not int or token_budget < 0:
            raise ValueError("Token budget must be a nonnegative integer.")

        text = ""
        included = []
        tokens_used = 0
        for match in matches:
            trial = f"{text}\n\n{match.memory.text}" if included else match.memory.text
            trial_tokens = self._count_tokens(trial)
            if trial_tokens > token_budget:
                break
            text = trial
            included.append(match)
            tokens_used = trial_tokens
        return BuiltContext(text, tuple(included), tokens_used)
