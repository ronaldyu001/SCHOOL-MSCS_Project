from dataclasses import dataclass
from typing import Protocol, Sequence

from domain.entities import Memory


@dataclass(frozen=True)
class MemoryMatch:
    memory: Memory
    score: float


class MemoryStorePort(Protocol):
    def upsert(
        self, memories: Sequence[Memory], vectors: Sequence[Sequence[float]]
    ) -> None:
        """Insert or replace memories by ID, pairing each with its vector."""
        ...

    def search(
        self, vector: Sequence[float], conversation_id: str, limit: int
    ) -> Sequence[MemoryMatch]:
        """Return matches from only the specified conversation, best first."""
        ...
