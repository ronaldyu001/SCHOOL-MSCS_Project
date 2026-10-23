from typing import Protocol, Sequence


class EmbeddingPort(Protocol):
    def embed(self, texts: Sequence[str]) -> Sequence[Sequence[float]]:
        ...
