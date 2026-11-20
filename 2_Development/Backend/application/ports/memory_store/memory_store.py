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
        self,
        vector: Sequence[float],
        conversation_id: str,
        limit: int,
        *,
        eligible_turn_ids: frozenset[str] | None = None,
    ) -> Sequence[MemoryMatch]:
        """Return the best matches after filtering by conversation and eligible source turns."""
        ...
