from collections.abc import Iterable, Iterator

from application.use_cases.retrieval import BuiltContext, score_evidence
from domain.entities import QA, Conversation

from .reward_input import RewardInput, RewardSkip


class R0Builder:
    """Prepare supervised evidence-recall examples."""

    def execute(
        self, conversations: Iterable[Conversation], questions: Iterable[QA]
    ) -> Iterator[RewardInput | RewardSkip]:
        turn_ids = {
            conversation.id: frozenset(
                turn.id for session in conversation.sessions for turn in session.turns
            )
            for conversation in conversations
        }
        for qa in questions:
            available = turn_ids.get(qa.conversation_id)
            if available is None:
                yield RewardSkip(qa.id, "missing_conversation")
                continue
            if not qa.question.strip():
                yield RewardSkip(qa.id, "invalid_question")
                continue

            # Some LoCoMo rows put several semicolon-separated IDs in one field.
            gold = frozenset(
                part.strip()
                for entry in qa.evidence_turn_ids
                for part in entry.split(";")
                if part.strip()
            )
            if not gold:
                yield RewardSkip(qa.id, "missing_evidence")
                continue
            if not gold <= available:
                yield RewardSkip(qa.id, "unresolved_evidence")
                continue

            def score(context: BuiltContext, expected: frozenset[str] = gold) -> float:
                return score_evidence(expected, context.source_turn_ids)

            yield RewardInput(qa.id, qa.conversation_id, qa.question, score)
