from dataclasses import dataclass, replace

from application.use_cases.retrieval.score_evidence import normalize_evidence_ids
from domain.entities import DatasetPartition, QA


@dataclass(frozen=True)
class QuestionPage:
    questions: tuple[QA, ...]
    total: int


class ListQuestions:
    def execute(
        self, partition: DatasetPartition, *, conversation_id: str | None, limit: int
    ) -> QuestionPage:
        if not 1 <= limit <= 500:
            raise ValueError("Limit must be between 1 and 500.")
        questions = [
            qa for qa in partition.qa
            if conversation_id is None or qa.conversation_id == conversation_id
        ]
        return QuestionPage(
            tuple(
                replace(qa, evidence_turn_ids=normalize_evidence_ids(qa.evidence_turn_ids))
                for qa in questions[:limit]
            ),
            len(questions),
        )
