from dataclasses import dataclass
from typing import Tuple


@dataclass(frozen=True)
class DatasetSplit:
    train_conversation_ids: Tuple[str, ...]
    validation_conversation_ids: Tuple[str, ...]
    test_conversation_ids: Tuple[str, ...]

    def __post_init__(self) -> None:
        all_ids = (
            self.train_conversation_ids
            + self.validation_conversation_ids
            + self.test_conversation_ids
        )
        if len(all_ids) != len(set(all_ids)):
            raise ValueError("Conversation IDs must be unique across all splits.")
