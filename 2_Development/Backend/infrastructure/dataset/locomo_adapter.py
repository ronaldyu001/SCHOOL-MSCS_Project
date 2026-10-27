import json
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, Tuple, Union

from domain.entities import Conversation, QA, QACategory, Session, Turn


CATEGORIES: Dict[int, QACategory] = {
    1: "multi_hop",
    2: "temporal",
    3: "open_domain",
    4: "single_hop",
    5: "adversarial",
}


class LoCoMoAdapter:
    def __init__(self, path: Union[str, Path]) -> None:
        self.path = Path(path)
        self._conversations: Optional[Tuple[Conversation, ...]] = None
        self._qa: Optional[Tuple[QA, ...]] = None

    def load_conversations(self) -> Tuple[Conversation, ...]:
        self._load()
        assert self._conversations is not None
        return self._conversations

    def load_qa(self) -> Tuple[QA, ...]:
        self._load()
        assert self._qa is not None
        return self._qa

    def _load(self) -> None:
        if self._conversations is not None:
            return

        with self.path.open(encoding="utf-8") as source:
            samples = json.load(source)
        if not isinstance(samples, list):
            raise ValueError("LoCoMo dataset must contain a JSON list of samples.")

        conversations = []
        questions = []
        for index, sample in enumerate(samples):
            try:
                conversation_id = sample["sample_id"]
                history = sample["conversation"]
                session_ids = sorted(
                    int(key.removeprefix("session_"))
                    for key in history
                    if re.fullmatch(r"session_\d+", key)
                )
                sessions = tuple(
                    Session(
                        id=session_id,
                        timestamp=datetime.strptime(
                            history[f"session_{session_id}_date_time"],
                            "%I:%M %p on %d %B, %Y",
                        ),
                        turns=tuple(
                            Turn(
                                id=turn["dia_id"],
                                speaker=turn["speaker"],
                                text=turn["text"],
                            )
                            for turn in history[f"session_{session_id}"]
                        ),
                    )
                    for session_id in session_ids
                )
                conversations.append(
                    Conversation(
                        id=conversation_id,
                        speakers=(history["speaker_a"], history["speaker_b"]),
                        sessions=sessions,
                    )
                )

                for question_index, item in enumerate(sample["qa"]):
                    answer = item.get("answer")
                    questions.append(
                        QA(
                            id=f"{conversation_id}:q{question_index}",
                            conversation_id=conversation_id,
                            question=item["question"],
                            category=CATEGORIES[item["category"]],
                            answer=None if answer is None else str(answer),
                            evidence_turn_ids=tuple(item.get("evidence", [])),
                        )
                    )
            except (KeyError, TypeError, ValueError, AttributeError) as error:
                raise ValueError(
                    f"Invalid LoCoMo sample at index {index}: {error}"
                ) from error

        self._conversations = tuple(conversations)
        self._qa = tuple(questions)
