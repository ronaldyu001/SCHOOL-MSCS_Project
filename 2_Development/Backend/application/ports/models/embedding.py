from typing import Protocol, Sequence


class EmbeddingPort(Protocol):
    @property
    def vector_size(self) -> int:
        ...

    def embed_documents(self, texts: Sequence[str]) -> Sequence[Sequence[float]]:
        ...

    def embed_queries(self, texts: Sequence[str]) -> Sequence[Sequence[float]]:
        ...
