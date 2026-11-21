from collections.abc import Sequence
from dataclasses import dataclass
from math import isfinite


def select_rewrite(
    scores: Sequence[float],
) -> tuple[int, float] | None:
    """Return the first best index and score when the scores show a preference."""
    if any(not isfinite(score) for score in scores):
        raise ValueError("Reward scores must be finite.")
    if len(scores) < 2:
        return None
    best = max(scores)
    if best == min(scores):
        return None
    return scores.index(best), best


@dataclass(frozen=True)
class RewriteSelection:
    index: int | None
    score: float | None
    tied_winners: int
    reason: str | None


class SelectRewrite:
    def execute(self, scores: Sequence[float]) -> RewriteSelection:
        winner = select_rewrite(scores)
        if winner is None:
            reason = "too_few_candidates" if len(scores) < 2 else "all_scores_tied"
            return RewriteSelection(None, None, 0, reason)
        index, score = winner
        return RewriteSelection(index, score, scores.count(score), None)
