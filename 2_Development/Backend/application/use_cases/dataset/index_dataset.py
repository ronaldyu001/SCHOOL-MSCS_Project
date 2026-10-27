from typing import Iterable, Sequence
from uuid import NAMESPACE_URL, uuid5

from application.ports.models.embedding import EmbeddingPort
from application.ports.memory_store import MemoryStorePort
from domain.entities import Conversation, Memory


class IndexDataset:
    def __init__(self, embedder: EmbeddingPort, memory_store: MemoryStorePort) -> None:
        self.embedder = embedder
        self.memory_store = memory_store

    def execute(
        self, conversations: Iterable[Conversation], batch_size: int = 64
    ) -> int:
        if type(batch_size) is not int or batch_size <= 0:
            raise ValueError("Batch size must be a positive integer.")

        batch = []
        indexed_count = 0
        for conversation in conversations:
            for session in conversation.sessions:
                for turn in session.turns:
                    memory = Memory(
                        id=str(uuid5(
                            NAMESPACE_URL,
                            f"memory-rewriter/{conversation.id}/{session.id}/{turn.id}",
                        )),
                        conversation_id=conversation.id,
                        session_id=session.id,
                        source_turn_ids=(turn.id,),
                        timestamp=session.timestamp,
                        text=f"[{session.timestamp.isoformat()}] {turn.speaker}: {turn.text}",
                    )
                    batch.append(memory)
                    if len(batch) == batch_size:
                        self._index_batch(batch)
                        indexed_count += len(batch)
                        batch = []

        if batch:
            self._index_batch(batch)
            indexed_count += len(batch)
        return indexed_count

    def _index_batch(self, memories: Sequence[Memory]) -> None:
        vectors = self.embedder.embed_documents([memory.text for memory in memories])
        if len(vectors) != len(memories):
            raise ValueError("Embedder must return one vector per memory.")
        if any(len(vector) == 0 for vector in vectors):
            raise ValueError("Embedding vectors must not be empty.")
        if len({len(vector) for vector in vectors}) != 1:
            raise ValueError("Embedding vectors must have consistent dimensions.")
        self.memory_store.upsert(memories, vectors)
