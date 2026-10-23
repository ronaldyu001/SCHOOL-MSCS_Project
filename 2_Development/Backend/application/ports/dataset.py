from typing import Protocol, Sequence

from domain.entities import QA, Conversation


class DatasetPort(Protocol):
    def load_conversations(self) -> Sequence[Conversation]:
        ...

    def load_qa(self) -> Sequence[QA]:
        ...
