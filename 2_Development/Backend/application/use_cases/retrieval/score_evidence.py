from collections.abc import Iterable
from dataclasses import dataclass


def normalize_evidence_ids(entries: Iterable[str]) -> tuple[str, ...]:
    """Split composite evidence IDs sometimes found in the dataset."""
    return tuple(dict.fromkeys(
        part.strip() for entry in entries for part in entry.split(";") if part.strip()
    ))


def score_evidence(expected_turn_ids: Iterable[str], actual_turn_ids: Iterable[str]) -> float:
    """Measure recall of unique expected turns among the packed memories."""
    expected = set(expected_turn_ids)
    if not expected:
        raise ValueError("Evidence recall requires at least one expected turn.")
    return len(expected.intersection(actual_turn_ids)) / len(expected)


@dataclass(frozen=True)
class EvidenceResult:
    recall: float
    expected_count: int
    matched_turn_ids: tuple[str, ...]


class MeasureEvidence:
    def execute(
        self, expected_turn_ids: Iterable[str], actual_turn_ids: Iterable[str]
    ) -> EvidenceResult:
        expected = set(normalize_evidence_ids(expected_turn_ids))
        matched = tuple(sorted(expected.intersection(actual_turn_ids)))
        return EvidenceResult(score_evidence(expected, matched), len(expected), matched)
