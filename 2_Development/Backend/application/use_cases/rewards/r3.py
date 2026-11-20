import re
from collections.abc import Callable, Iterable, Iterator

from application.use_cases.retrieval import BuiltContext
from domain.entities import Conversation

from .reward_input import RewardInput, RewardSkip
from .turns import sample_turns


_QUESTION_PROMPT = (
    "Write one standalone question that the statement answers. Use the person's name "
    "if available. The question should make sense by itself.\n\n"
    "Statement: Robin moved to Tucson in 2021.\n"
    "Question: When did Robin move to Tucson?\n\n"
    "Statement: I always take chamomile tea when I have trouble sleeping.\n"
    "Question: What tea helps the speaker fall asleep?\n\n"
    "Statement: {source}\nQuestion:"
)


def _extract_question(text: str) -> str | None:
    line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    line = re.sub(r"^question:\s*", "", line, flags=re.IGNORECASE).lstrip("\"'")
    question, mark, _ = line.partition("?")
    words = re.findall(r"[^\W_]+", question.casefold())
    if not mark or not words:
        return None
    if re.search(r"\b(?:this|the) (?:statement|excerpt|passage|text)\b", question, re.IGNORECASE):
        return None
    return question.rstrip() + "?"


class R3Builder:
    """Create synthetic question/source pairs using conversation turns."""

    def __init__(self, generate_question: Callable[[str], str]) -> None:
        self._generate_question = generate_question

    def execute(
        self, conversations: Iterable[Conversation], *, seed: int = 123
    ) -> Iterator[RewardInput | RewardSkip]:
        for conversation_id, turns, position in sample_turns(conversations, seed=seed):
            source = turns[position].turn
            input_id = f"{conversation_id}:{source.id}"
            if not source.text.strip():
                yield RewardSkip(input_id, "blank_source_turn")
                continue
            # Collapse formatting to keep the source within the example's statement field.
            statement = " ".join(source.text.split())
            output = self._generate_question(
                _QUESTION_PROMPT.format(source=f"{source.speaker}: {statement}")
            )
            question = _extract_question(output)
            if question is None:
                yield RewardSkip(input_id, "invalid_synthetic_question")
                continue

            def score(context: BuiltContext, source_id: str = source.id) -> float:
                return float(source_id in context.source_turn_ids)

            yield RewardInput(input_id, conversation_id, question, score)
