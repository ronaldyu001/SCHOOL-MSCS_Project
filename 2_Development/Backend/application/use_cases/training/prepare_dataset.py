from dataclasses import dataclass
from typing import Optional, Sequence, Tuple

from application.ports.dataset import DatasetPort
from domain.entities import QA, Conversation, DatasetSplit, QACategory


@dataclass(frozen=True)
class DatasetPartition:
    conversations: Tuple[Conversation, ...]
    qa: Tuple[QA, ...]


@dataclass(frozen=True)
class PreparedDataset:
    train: DatasetPartition
    validation: DatasetPartition
    test: DatasetPartition


class PrepareDataset:
    def __init__(self, dataset: DatasetPort) -> None:
        self.dataset = dataset

    def execute(
        self,
        split: DatasetSplit,
        categories: Optional[Sequence[QACategory]] = None,
    ) -> PreparedDataset:
        conversations = tuple(self.dataset.load_conversations())
        qa = tuple(self.dataset.load_qa())
        conversations_by_id = {item.id: item for item in conversations}

        if len(conversations_by_id) != len(conversations):
            raise ValueError("Dataset contains duplicate conversation IDs.")
        if len({item.id for item in qa}) != len(qa):
            raise ValueError("Dataset contains duplicate QA IDs.")

        requested_ids = set(
            split.train_conversation_ids
            + split.validation_conversation_ids
            + split.test_conversation_ids
        )
        unknown_ids = requested_ids - conversations_by_id.keys()
        if unknown_ids:
            raise ValueError(f"Unknown conversation IDs in split: {sorted(unknown_ids)}")

        orphan_ids = {item.conversation_id for item in qa} - conversations_by_id.keys()
        if orphan_ids:
            raise ValueError(f"QA references unknown conversations: {sorted(orphan_ids)}")

        allowed_categories = None if categories is None else set(categories)
        filtered_qa = tuple(
            item for item in qa
            if allowed_categories is None or item.category in allowed_categories
        )

        def partition(ids: Tuple[str, ...]) -> DatasetPartition:
            selected_ids = set(ids)
            return DatasetPartition(
                conversations=tuple(conversations_by_id[item_id] for item_id in ids),
                qa=tuple(item for item in filtered_qa if item.conversation_id in selected_ids),
            )

        return PreparedDataset(
            train=partition(split.train_conversation_ids),
            validation=partition(split.validation_conversation_ids),
            test=partition(split.test_conversation_ids),
        )
