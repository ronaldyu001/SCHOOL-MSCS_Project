from collections.abc import Sequence
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
