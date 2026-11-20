from collections.abc import Sequence

from application.ports.memory_store import MemoryMatch, MemoryStorePort
from application.ports.models.embedding import EmbeddingPort


class RetrieveMemories:
    def __init__(self, embedder: EmbeddingPort, store: MemoryStorePort) -> None:
        self._embedder = embedder
        self._store = store

    def execute(
        self,
        queries: Sequence[str],
        *,
        conversation_id: str,
        top_k: int,
        eligible_turn_ids: frozenset[str] | None = None,
    ) -> tuple[tuple[MemoryMatch, ...], ...]:
        if type(top_k) is not int or top_k <= 0:
            raise ValueError("Search depth must be a positive integer.")
        if not conversation_id.strip() or any(not query.strip() for query in queries):
            raise ValueError("Conversation ID and queries must not be blank.")
        if not queries or eligible_turn_ids == frozenset():
            return tuple(() for _ in queries)

        vectors = self._embedder.embed_queries(queries)
        if len(vectors) != len(queries):
            raise ValueError("Embedder must return one vector per query.")

        return tuple(
            tuple(
                self._store.search(
                    vector, conversation_id, top_k, eligible_turn_ids=eligible_turn_ids
                )
            )
            for vector in vectors
        )
