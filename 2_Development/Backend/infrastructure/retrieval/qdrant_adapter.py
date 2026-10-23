from datetime import datetime
from typing import Sequence
from uuid import NAMESPACE_URL, uuid5

from qdrant_client import QdrantClient, models

from application.ports.memory_store import MemoryMatch
from domain.entities import Memory


class QdrantAdapter:
    def __init__(
        self, client: QdrantClient, collection_name: str, vector_size: int
    ) -> None:
        if vector_size <= 0:
            raise ValueError("Vector size must be positive.")
        self.client = client
        self.collection_name = collection_name
        self.vector_size = vector_size

    def ensure_collection(self) -> None:
        """Create a cosine collection, or verify an existing one without deleting it."""
        if not self.client.collection_exists(self.collection_name):
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=models.VectorParams(
                    size=self.vector_size, distance=models.Distance.COSINE
                ),
            )
        config = self.client.get_collection(self.collection_name).config.params.vectors
        if (
            not isinstance(config, models.VectorParams)
            or config.size != self.vector_size
            or config.distance != models.Distance.COSINE
        ):
            raise ValueError("Collection must use the configured vector size and cosine distance.")
        self.client.create_payload_index(
            collection_name=self.collection_name,
            field_name="conversation_id",
            field_schema=models.PayloadSchemaType.KEYWORD,
            wait=True,
        )

    def upsert(
        self, memories: Sequence[Memory], vectors: Sequence[Sequence[float]]
    ) -> None:
        if len(memories) != len(vectors):
            raise ValueError("Each memory must have exactly one vector.")
        if not memories:
            return
        points = []
        for memory, vector in zip(memories, vectors):
            self._validate_vector(vector)
            points.append(models.PointStruct(
                id=str(uuid5(NAMESPACE_URL, f"memory-store/{memory.id}")),
                vector=list(vector),
                payload={
                    "id": memory.id,
                    "conversation_id": memory.conversation_id,
                    "session_id": memory.session_id,
                    "source_turn_ids": list(memory.source_turn_ids),
                    "timestamp": memory.timestamp.isoformat(),
                    "text": memory.text,
                },
            ))
        self.client.upsert(
            collection_name=self.collection_name, points=points, wait=True
        )

    def search(
        self, vector: Sequence[float], conversation_id: str, limit: int
    ) -> Sequence[MemoryMatch]:
        if limit <= 0:
            raise ValueError("Search limit must be positive.")
        self._validate_vector(vector)
        result = self.client.query_points(
            collection_name=self.collection_name,
            query=list(vector),
            query_filter=models.Filter(must=[models.FieldCondition(
                key="conversation_id", match=models.MatchValue(value=conversation_id)
            )]),
            limit=limit,
            with_payload=True,
            with_vectors=False,
        )
        matches = []
        for point in result.points:
            payload = point.payload or {}
            matches.append(MemoryMatch(
                memory=Memory(
                    id=payload["id"],
                    conversation_id=payload["conversation_id"],
                    session_id=payload["session_id"],
                    source_turn_ids=tuple(payload["source_turn_ids"]),
                    timestamp=datetime.fromisoformat(payload["timestamp"]),
                    text=payload["text"],
                ),
                score=point.score,
            ))
        return tuple(matches)

    def _validate_vector(self, vector: Sequence[float]) -> None:
        if len(vector) != self.vector_size:
            raise ValueError(f"Expected vector size {self.vector_size}, got {len(vector)}.")
