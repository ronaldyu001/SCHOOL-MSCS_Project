from random import Random
from typing import Sequence

from domain.entities import DatasetSplit


class CreateDatasetSplit:
    def execute(
        self,
        conversation_ids: Sequence[str],
        train_size: int,
        validation_size: int,
        test_size: int,
        seed: int = 123,
    ) -> DatasetSplit:
        sizes = (train_size, validation_size, test_size)
        if any(type(size) is not int or size < 0 for size in sizes):
            raise ValueError("Split sizes must be non-negative integers.")
        if len(conversation_ids) != len(set(conversation_ids)):
            raise ValueError("Conversation IDs must be unique.")
        if sum(sizes) != len(conversation_ids):
            raise ValueError("Split sizes must sum to the number of conversations.")

        ids = sorted(conversation_ids)
        Random(seed).shuffle(ids)
        validation_start = train_size
        test_start = train_size + validation_size

        return DatasetSplit(
            train_conversation_ids=tuple(ids[:validation_start]),
            validation_conversation_ids=tuple(ids[validation_start:test_start]),
            test_conversation_ids=tuple(ids[test_start:]),
        )
