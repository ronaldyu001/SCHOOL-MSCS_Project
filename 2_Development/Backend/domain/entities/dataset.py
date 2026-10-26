from dataclasses import dataclass
from typing import Tuple

from .conversation import Conversation
from .qa import QA


@dataclass(frozen=True)
class Dataset:
    conversations: Tuple[Conversation, ...]
    qa: Tuple[QA, ...]

    @property
    def conversation_ids(self) -> Tuple[str, ...]:
        return tuple(item.id for item in self.conversations)


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


@dataclass(frozen=True)
class DatasetPartition:
    conversations: Tuple[Conversation, ...]
    qa: Tuple[QA, ...]


@dataclass(frozen=True)
class PreparedDataset:
    train: DatasetPartition
    validation: DatasetPartition
    test: DatasetPartition
