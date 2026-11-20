from collections.abc import Iterable


def score_evidence(expected_turn_ids: Iterable[str], actual_turn_ids: Iterable[str]) -> float:
    """Measure recall of unique expected turns among the packed memories."""
    expected = set(expected_turn_ids)
    if not expected:
        raise ValueError("Evidence recall requires at least one expected turn.")
    return len(expected.intersection(actual_turn_ids)) / len(expected)
