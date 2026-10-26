from typing import Optional, Sequence, Tuple

from domain.entities import (
    Dataset, DatasetPartition, DatasetSplit, PreparedDataset, QACategory,
)


class PrepareDataset:
    def execute(
        self,
        dataset: Dataset,
        split: DatasetSplit,
        categories: Optional[Sequence[QACategory]] = None,
    ) -> PreparedDataset:
        conversations = dataset.conversations
        qa = dataset.qa
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

        if requested_ids != set(conversations_by_id):
            raise ValueError("Split must include every conversation in the dataset.")

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
